import type { Config, EventConfig, EventStatus, ScrapeResult } from './types.ts';
import { initBrowser, closeBrowser, scrapeEvent } from './scraper.ts';
import EventStateTracker from './state.ts';
import { sendNotification, sendUnhealthyAlert } from './notifier.ts';
import { createLogger } from './logger.ts';

let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let currentPollPromise: Promise<void> | null = null;
let isRunning = false;
let activeDeps: Required<Dependencies> | null = null;

let tracker: EventStateTracker;
const failureAttempts = new Map<string, number>();
const lastAttemptTimes = new Map<string, number>();

const MAX_BACKOFF_MS = 900_000;

interface Dependencies {
  initBrowser?: typeof initBrowser;
  closeBrowser?: typeof closeBrowser;
  scrapeEvent?: typeof scrapeEvent;
  sendNotification?: typeof sendNotification;
  sendUnhealthyAlert?: typeof sendUnhealthyAlert;
  EventStateTracker?: typeof EventStateTracker;
  createLogger?: typeof createLogger;
}

interface StartOptions {
  immediate?: boolean;
  deps?: Dependencies;
}

function calculateBackoff(baseIntervalMs: number, attempt: number): number {
  return Math.min(baseIntervalMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
}

export async function startMonitoring(config: Config, options?: StartOptions): Promise<void> {
  const deps: Required<Dependencies> = {
    initBrowser: options?.deps?.initBrowser ?? initBrowser,
    closeBrowser: options?.deps?.closeBrowser ?? closeBrowser,
    scrapeEvent: options?.deps?.scrapeEvent ?? scrapeEvent,
    sendNotification: options?.deps?.sendNotification ?? sendNotification,
    sendUnhealthyAlert: options?.deps?.sendUnhealthyAlert ?? sendUnhealthyAlert,
    EventStateTracker: options?.deps?.EventStateTracker ?? EventStateTracker,
    createLogger: options?.deps?.createLogger ?? createLogger,
  };

  const log = deps.createLogger('orchestrator');

  if (isRunning) {
    log.warn('Monitoring already running');
    return;
  }

  isRunning = true;
  activeDeps = deps;
  tracker = new deps.EventStateTracker();
  failureAttempts.clear();
  lastAttemptTimes.clear();

  await deps.initBrowser();
  log.info({ eventCount: config.events.length, pollIntervalMs: config.pollIntervalMs }, 'Starting monitoring');

  if (options?.immediate) {
    currentPollPromise = runPoll(config, deps, log);
    await currentPollPromise;
    currentPollPromise = null;
  }

  pollIntervalId = setInterval(() => {
    if (!isRunning) return;
    currentPollPromise = runPoll(config, deps, log).finally(() => {
      currentPollPromise = null;
    });
  }, config.pollIntervalMs);
}

async function runPoll(config: Config, deps: Required<Dependencies>, log: ReturnType<typeof createLogger>): Promise<void> {
  log.info('Starting poll cycle');

  for (const event of config.events) {
    if (!isRunning) break;

    const eventLog = log.child({ eventId: event.url, eventName: event.name });
    const attempt = failureAttempts.get(event.url) || 0;
    const backoffMs = calculateBackoff(config.pollIntervalMs, attempt);
    const lastAttempt = lastAttemptTimes.get(event.url) || 0;
    const now = Date.now();

    if (lastAttempt > 0 && now - lastAttempt < backoffMs) {
      eventLog.debug({ backoffMs, timeUntilNext: backoffMs - (now - lastAttempt) }, 'Event in backoff, skipping');
      continue;
    }

    lastAttemptTimes.set(event.url, now);
    eventLog.info({ attempt, backoffMs }, 'Processing event');

    let result: ScrapeResult;
    try {
      result = await deps.scrapeEvent(event.url);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      eventLog.error({ error: errorMsg }, 'Unexpected scrape error');
      result = { state: 'unknown', categories: [] };
    }

    eventLog.info({ state: result.state, categories: result.categories.length }, 'Scrape complete');

    let consecutiveFailures: number;

    if (result.state === 'unknown') {
      const newAttempt = attempt + 1;
      failureAttempts.set(event.url, newAttempt);
      consecutiveFailures = tracker.incrementFailure(event.url);
      const newBackoffMs = calculateBackoff(config.pollIntervalMs, newAttempt);
      eventLog.warn({ attempt: newAttempt, consecutiveFailures, backoffMs: newBackoffMs }, 'Scrape failed, backing off');

      if (tracker.isUnhealthy(event.url)) {
        eventLog.error({ consecutiveFailures }, 'Event is unhealthy');
        try {
          await deps.sendUnhealthyAlert(config.discordWebhookUrl, event, consecutiveFailures, config.discordUserId);
          eventLog.info('Unhealthy alert sent');
        } catch (err) {
          eventLog.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to send unhealthy alert');
        }
      }
    } else {
      failureAttempts.set(event.url, 0);
      tracker.resetFailures(event.url);
      consecutiveFailures = 0;
      eventLog.info('Scrape succeeded, reset backoff');
    }

    const status: EventStatus = {
      url: event.url,
      state: result.state,
      categories: result.categories,
      lastChecked: new Date(),
      consecutiveFailures,
    };

    const changes = tracker.updateState(event.url, event, status);

    if (changes.length > 0) {
      eventLog.info(
        { changes: changes.length, previousState: changes[0].previousState, newState: changes[0].newState },
        'State changed',
      );

      for (const change of changes) {
        try {
          await deps.sendNotification(config.discordWebhookUrl, event, status, config.discordUserId);
          eventLog.info('Notification sent');
        } catch (err) {
          eventLog.error({ error: err instanceof Error ? err.message : String(err) }, 'Failed to send notification');
        }
      }
    } else {
      eventLog.debug('No state change');
    }
  }

  log.info('Poll cycle complete');
}

export async function stopMonitoring(): Promise<void> {
  const log = createLogger('orchestrator');

  if (!isRunning) {
    log.warn('Monitoring not running');
    return;
  }

  log.info('Stopping monitoring');
  isRunning = false;

  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }

  if (currentPollPromise) {
    log.info('Waiting for current poll to complete');
    let timedOut = false;
    const timeoutPromise = new Promise<void>((resolve) => {
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, 30_000);
    });
    await Promise.race([currentPollPromise, timeoutPromise]);
    if (timedOut) {
      log.warn('Current poll timed out after 30s');
    }
    currentPollPromise = null;
  }

  if (activeDeps) {
    await activeDeps.closeBrowser();
    activeDeps = null;
  }
  log.info('Monitoring stopped');
}
