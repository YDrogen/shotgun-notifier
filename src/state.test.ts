import { expect, test, describe, beforeEach } from "bun:test";
import EventStateTracker from "./state.ts";
import type { EventConfig, EventStatus } from "./types.ts";

describe("EventStateTracker", () => {
  let tracker: EventStateTracker;
  const mockUrl = "https://example.com/event";
  const mockEvent: EventConfig = { url: mockUrl, name: "Test Event" };

  beforeEach(() => {
    tracker = new EventStateTracker();
  });

  test("First update returns state change (unknown → any state)", () => {
    const status: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [{ name: "General", status: "available" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    const changes = tracker.updateState(mockUrl, mockEvent, status);
    expect(changes).toHaveLength(1);
    expect(changes[0].previousState).toBe("unknown");
    expect(changes[0].newState).toBe("available");
  });

  test("Same state on consecutive updates returns no state change", () => {
    const status1: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [{ name: "General", status: "available" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    tracker.updateState(mockUrl, mockEvent, status1);
    const changes = tracker.updateState(mockUrl, mockEvent, status1);
    expect(changes).toHaveLength(0);
  });

  test("Transition from sold_out → available returns state change", () => {
    const soldOut: EventStatus = {
      url: mockUrl,
      state: "sold_out",
      categories: [{ name: "General", status: "sold_out" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    const available: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [{ name: "General", status: "available" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };

    tracker.updateState(mockUrl, mockEvent, soldOut);
    const changes = tracker.updateState(mockUrl, mockEvent, available);
    
    expect(changes).toHaveLength(1);
    expect(changes[0].previousState).toBe("sold_out");
    expect(changes[0].newState).toBe("available");
  });

  test("Transition from available → sold_out returns state change", () => {
    const available: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [{ name: "General", status: "available" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };

    const soldOut: EventStatus = {
      url: mockUrl,
      state: "sold_out",
      categories: [{ name: "General", status: "sold_out" }],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    tracker.updateState(mockUrl, mockEvent, available);
    const changes = tracker.updateState(mockUrl, mockEvent, soldOut);
    
    expect(changes).toHaveLength(1);
    expect(changes[0].previousState).toBe("available");
    expect(changes[0].newState).toBe("sold_out");
  });

  test("Consecutive failures tracked correctly", () => {
    const status: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    tracker.updateState(mockUrl, mockEvent, status);
    
    expect(tracker.incrementFailure(mockUrl)).toBe(1);
    expect(tracker.incrementFailure(mockUrl)).toBe(2);
    
    const current = tracker.getState(mockUrl);
    expect(current?.consecutiveFailures).toBe(2);
  });

  test("isUnhealthy returns true at threshold 5", () => {
    const status: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    tracker.updateState(mockUrl, mockEvent, status);
    
    for (let i = 0; i < 4; i++) {
      tracker.incrementFailure(mockUrl);
    }
    expect(tracker.isUnhealthy(mockUrl)).toBe(false);
    
    tracker.incrementFailure(mockUrl);
    expect(tracker.isUnhealthy(mockUrl)).toBe(true);
  });

  test("resetFailures resets counter to 0", () => {
    const status: EventStatus = {
      url: mockUrl,
      state: "available",
      categories: [],
      lastChecked: new Date(),
      consecutiveFailures: 0,
    };
    
    tracker.updateState(mockUrl, mockEvent, status);
    tracker.incrementFailure(mockUrl);
    tracker.incrementFailure(mockUrl);
    
    expect(tracker.getState(mockUrl)?.consecutiveFailures).toBe(2);
    
    tracker.resetFailures(mockUrl);
    expect(tracker.getState(mockUrl)?.consecutiveFailures).toBe(0);
    expect(tracker.isUnhealthy(mockUrl)).toBe(false);
  });
});