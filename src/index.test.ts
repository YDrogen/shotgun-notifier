import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { z } from 'zod';
import { main, parseConfigPath, type Dependencies } from './index';

const VALID_CONFIG = {
  events: [{ url: 'https://example.com/event', name: 'Test Event' }],
  discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
  pollIntervalMs: 60000,
};

describe('parseConfigPath', () => {
  it('returns default path when no --config flag', () => {
    expect(parseConfigPath([])).toBe('./config.json');
  });

  it('returns custom path when --config flag is provided', () => {
    expect(parseConfigPath(['--config', 'custom.json'])).toBe('custom.json');
  });

  it('returns default path when --config is last arg without value', () => {
    expect(parseConfigPath(['--config'])).toBe('./config.json');
  });
});

describe('main', () => {
  let stderrOutput: string[] = [];
  let stdoutOutput: string[] = [];
  let originalStderr: typeof console.error;
  let originalStdout: typeof console.log;
  let mockLoadConfig: ReturnType<typeof mock>;
  let mockValidateWebhookUrl: ReturnType<typeof mock>;
  let mockInitBrowser: ReturnType<typeof mock>;
  let mockStartMonitoring: ReturnType<typeof mock>;
  let mockStopMonitoring: ReturnType<typeof mock>;
  let testDeps: Dependencies;

  beforeEach(() => {
    stderrOutput = [];
    stdoutOutput = [];
    originalStderr = console.error;
    originalStdout = console.log;
    console.error = (...args: any[]) => {
      stderrOutput.push(args.join(' '));
    };
    console.log = (...args: any[]) => {
      stdoutOutput.push(args.join(' '));
    };

    mockLoadConfig = mock(() => VALID_CONFIG);
    mockValidateWebhookUrl = mock(() => Promise.resolve(true));
    mockInitBrowser = mock(() => Promise.resolve());
    mockStartMonitoring = mock(() => Promise.resolve());
    mockStopMonitoring = mock(() => Promise.resolve());

    testDeps = {
      loadConfig: mockLoadConfig as unknown as (path: string) => { events: any[]; discordWebhookUrl: string; pollIntervalMs: number },
      validateWebhookUrl: mockValidateWebhookUrl as unknown as (url: string) => Promise<boolean>,
      initBrowser: mockInitBrowser as unknown as () => Promise<void>,
      startMonitoring: mockStartMonitoring as unknown as (config: any) => Promise<void>,
      stopMonitoring: mockStopMonitoring as unknown as () => Promise<void>,
    };
  });

  afterEach(() => {
    console.error = originalStderr;
    console.log = originalStdout;
  });

  it('valid config starts monitoring', async () => {
    await main({ deps: testDeps });
    expect(mockLoadConfig).toHaveBeenCalledWith('./config.json');
    expect(mockValidateWebhookUrl).toHaveBeenCalledWith(VALID_CONFIG.discordWebhookUrl);
    expect(mockInitBrowser).toHaveBeenCalled();
    expect(mockStartMonitoring).toHaveBeenCalledWith(VALID_CONFIG);
    expect(stdoutOutput.some((s) => s.includes('Shotgun Ticket Monitor started'))).toBe(true);
  });

  it('invalid config exits with code 1', async () => {
    const zodError = new z.ZodError([
      {
        path: ['events'],
        message: 'Required',
        code: 'invalid_type',
        expected: 'array',
        received: 'undefined',
      },
    ]);
    mockLoadConfig.mockImplementation(() => {
      throw zodError;
    });

    await expect(main({ deps: testDeps })).rejects.toThrow('Config load failed');
    expect(stderrOutput.some((s) => s.includes('Config validation failed'))).toBe(true);
  });

  it('missing webhook URL exits with code 1', async () => {
    mockValidateWebhookUrl.mockResolvedValue(false);

    await expect(main({ deps: testDeps })).rejects.toThrow('Invalid webhook URL');
    expect(stderrOutput.some((s) => s.includes('Invalid webhook URL'))).toBe(true);
  });

  it('SIGTERM triggers graceful shutdown', async () => {
    const signalHandlers: Record<string, Function> = {};
    const originalOn = process.on.bind(process);
    process.on = ((event: string, handler: Function) => {
      signalHandlers[event] = handler;
      return process;
    }) as typeof process.on;

    await main({ deps: testDeps });

    process.on = originalOn;

    expect(signalHandlers['SIGTERM']).toBeDefined();

    const originalExit = process.exit;
    let exitCalled = false;
    let exitCode: number | null = null;
    process.exit = ((code?: number) => {
      exitCalled = true;
      exitCode = code ?? 0;
    }) as typeof process.exit;

    await signalHandlers['SIGTERM']();

    process.exit = originalExit;

    expect(mockStopMonitoring).toHaveBeenCalled();
    expect(exitCalled).toBe(true);
    expect(exitCode).toBe(0);
    expect(stdoutOutput.some((s) => s.includes('Shutting down gracefully'))).toBe(true);
  });

  it('--config flag parsing works', async () => {
    const originalArgv = process.argv;
    process.argv = ['node', 'index.ts', '--config', 'my-config.json'];

    try {
      await main({ deps: testDeps });
      expect(mockLoadConfig).toHaveBeenCalledWith('my-config.json');
    } finally {
      process.argv = originalArgv;
    }
  });
});