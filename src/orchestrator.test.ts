import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import type { Config, ScrapeResult } from "./types.ts";
import EventStateTracker from "./state.ts";

const mockInitBrowser = mock(() => Promise.resolve());
const mockCloseBrowser = mock(() => Promise.resolve());
const mockScrapeEvent = mock((url: string) =>
  Promise.resolve<ScrapeResult>({ state: "available", categories: [] }),
);
const mockSendNotification = mock(() => Promise.resolve());
const mockSendUnhealthyAlert = mock(() => Promise.resolve());

const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  child: mock(() => mockLogger),
};

const mockCreateLogger = mock(() => mockLogger);

const { startMonitoring, stopMonitoring } = await import("./orchestrator.ts");

const TEST_CONFIG: Config = {
  events: [
    { url: "https://example.com/event1", name: "Event 1" },
    { url: "https://example.com/event2", name: "Event 2" },
  ],
  discordWebhookUrl: "https://discord.com/api/webhooks/test",
  pollIntervalMs: 1000,
};

const TEST_DEPS = {
  initBrowser: mockInitBrowser,
  closeBrowser: mockCloseBrowser,
  scrapeEvent: mockScrapeEvent,
  sendNotification: mockSendNotification,
  sendUnhealthyAlert: mockSendUnhealthyAlert,
  EventStateTracker: EventStateTracker,
  createLogger: mockCreateLogger,
};

describe("orchestrator", () => {
  beforeEach(() => {
    mockInitBrowser.mockClear();
    mockCloseBrowser.mockClear();
    mockScrapeEvent.mockClear();
    mockSendNotification.mockClear();
    mockSendUnhealthyAlert.mockClear();
    mockLogger.info.mockClear();
    mockLogger.warn.mockClear();
    mockLogger.error.mockClear();
    mockLogger.debug.mockClear();
    mockLogger.child.mockClear();
    mockCreateLogger.mockClear();
  });

  afterEach(async () => {
    await stopMonitoring();
  });

  it("initializes browser and starts polling on startMonitoring", async () => {
    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(mockInitBrowser).toHaveBeenCalledTimes(1);
    expect(mockScrapeEvent).toHaveBeenCalledTimes(2);
  });

  it("processes events sequentially", async () => {
    const callOrder: string[] = [];
    mockScrapeEvent.mockImplementation(async (url: string) => {
      callOrder.push(url);
      return { state: "available", categories: [] };
    });

    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(callOrder).toEqual([
      TEST_CONFIG.events[0].url,
      TEST_CONFIG.events[1].url,
    ]);
  });

  it("sends notification on state change", async () => {
    mockScrapeEvent.mockResolvedValue({
      state: "available",
      categories: [{ name: "GA", status: "available" }],
    });

    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("stops polling and closes browser on stopMonitoring", async () => {
    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    await stopMonitoring();
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
  });

  it("does not start if already running", async () => {
    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    mockInitBrowser.mockClear();
    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(mockInitBrowser).toHaveBeenCalledTimes(0);
  });

  it("increments failure and applies backoff on unknown state", async () => {
    mockScrapeEvent.mockResolvedValue({ state: "unknown", categories: [] });

    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(mockScrapeEvent).toHaveBeenCalledTimes(2);
  });

  it("sends unhealthy alert after 5 consecutive failures", async () => {
    let callCount = 0;
    mockScrapeEvent.mockImplementation(async () => {
      callCount++;
      return { state: "unknown", categories: [] };
    });

    const config: Config = {
      events: [{ url: "https://example.com/unhealthy", name: "Unhealthy Event" }],
      discordWebhookUrl: "https://discord.com/api/webhooks/test",
      pollIntervalMs: 10,
    };

    await startMonitoring(config, { deps: TEST_DEPS });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await stopMonitoring();

    expect(mockSendUnhealthyAlert).toHaveBeenCalled();
  });

  it("resets backoff on successful scrape", async () => {
    let callCount = 0;
    mockScrapeEvent.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return { state: "unknown", categories: [] };
      }
      return { state: "available", categories: [] };
    });

    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(callCount).toBe(2);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });

  it("handles scrape errors gracefully without throwing", async () => {
    mockScrapeEvent.mockRejectedValue(new Error("Network error"));

    await expect(
      startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS }),
    ).resolves.toBeUndefined();
    expect(mockScrapeEvent).toHaveBeenCalledTimes(2);
  });

  it("skips events in backoff", async () => {
    let callCount = 0;
    mockScrapeEvent.mockImplementation(async () => {
      callCount++;
      return { state: "unknown", categories: [] };
    });

    const config: Config = {
      events: [{ url: "https://example.com/backoff", name: "Backoff Event" }],
      discordWebhookUrl: "https://discord.com/api/webhooks/test",
      pollIntervalMs: 50,
    };

    await startMonitoring(config, { deps: TEST_DEPS });
    await new Promise((resolve) => setTimeout(resolve, 150));
    await stopMonitoring();

    expect(callCount).toBeGreaterThanOrEqual(1);
    expect(callCount).toBeLessThan(5);
  });

  it("waits for current poll on stopMonitoring", async () => {
    let resolved = false;
    mockScrapeEvent.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      resolved = true;
      return { state: "available", categories: [] };
    });

    const config: Config = {
      ...TEST_CONFIG,
      pollIntervalMs: 10,
    };

    await startMonitoring(config, { deps: TEST_DEPS });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await stopMonitoring();
    expect(resolved).toBe(true);
  });

  it("logs poll start and completion", async () => {
    await startMonitoring(TEST_CONFIG, { immediate: true, deps: TEST_DEPS });
    expect(mockLogger.info).toHaveBeenCalledWith("Starting poll cycle");
    expect(mockLogger.info).toHaveBeenCalledWith("Poll cycle complete");
  });
});
