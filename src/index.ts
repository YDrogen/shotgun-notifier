import { z } from 'zod';
import { loadConfig } from './config.js';
import { startMonitoring, stopMonitoring } from './orchestrator.js';
import { validateWebhookUrl } from './notifier.js';
import { initBrowser } from './scraper.js';
import type { Config } from './types.js';
import type { Browser } from 'playwright';

export interface Dependencies {
  loadConfig?: (path: string) => Config;
  validateWebhookUrl?: (url: string) => Promise<boolean>;
  initBrowser?: () => Promise<Browser | void>;
  startMonitoring?: (config: Config) => Promise<void>;
  stopMonitoring?: () => Promise<void>;
}

const defaultDeps: Required<Dependencies> = {
  loadConfig,
  validateWebhookUrl,
  initBrowser,
  startMonitoring,
  stopMonitoring,
};

let isShuttingDown = false;

export async function main(options?: { deps?: Dependencies }): Promise<void> {
  const deps = {
    loadConfig: options?.deps?.loadConfig ?? defaultDeps.loadConfig,
    validateWebhookUrl: options?.deps?.validateWebhookUrl ?? defaultDeps.validateWebhookUrl,
    initBrowser: options?.deps?.initBrowser ?? defaultDeps.initBrowser,
    startMonitoring: options?.deps?.startMonitoring ?? defaultDeps.startMonitoring,
    stopMonitoring: options?.deps?.stopMonitoring ?? defaultDeps.stopMonitoring,
  };

  const configPath = parseConfigPath();

  let config: Config;
  try {
    config = deps.loadConfig(configPath);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formatted = error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('\n');
      console.error(`Config validation failed:\n${formatted}`);
    } else {
      console.error(
        `Failed to load config: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    throw Object.assign(new Error('Config load failed'), { exitCode: 1 });
  }

  const validWebhook = await deps.validateWebhookUrl(config.discordWebhookUrl);
  if (!validWebhook) {
    console.error('Invalid webhook URL');
    throw Object.assign(new Error('Invalid webhook URL'), { exitCode: 1 });
  }

  await deps.initBrowser();

  setupSignalHandlers(deps.stopMonitoring);

  console.log(
    `Shotgun Ticket Monitor started. Monitoring ${config.events.length} events at ${config.pollIntervalMs}ms interval.`,
  );

  await deps.startMonitoring(config);
}

export function parseConfigPath(argv: string[] = process.argv.slice(2)): string {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && i + 1 < argv.length) {
      return argv[i + 1];
    }
  }
  return './config.json';
}

function setupSignalHandlers(stopFn: () => Promise<void>): void {
  process.on('SIGTERM', async () => {
    await handleShutdown('SIGTERM', stopFn);
  });

  process.on('SIGINT', async () => {
    await handleShutdown('SIGINT', stopFn);
  });

  process.on('beforeExit', async () => {
    if (!isShuttingDown) {
      await handleShutdown('beforeExit', stopFn);
    }
  });
}

async function handleShutdown(signal: string, stopFn: () => Promise<void>): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('Shutting down gracefully');

  await stopFn();

  process.exit(0);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(error.exitCode ?? 1);
  });
}
