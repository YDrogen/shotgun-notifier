import { describe, it, expect } from 'bun:test';
import { configSchema, loadConfig } from './config.js';
import { writeFileSync, unlinkSync } from 'fs';

const VALID_CONFIG = {
  events: [{ url: 'https://example.com/event', name: 'Test Event' }],
  discordWebhookUrl: 'https://discord.com/api/webhooks/123/abc',
  pollIntervalMs: 60000,
};

describe('configSchema', () => {
  it('valid config loads successfully', () => {
    const result = configSchema.parse(VALID_CONFIG);
    expect(result.events).toHaveLength(1);
    expect(result.discordWebhookUrl).toBe(VALID_CONFIG.discordWebhookUrl);
    expect(result.pollIntervalMs).toBe(60000);
  });

  it('missing discordWebhookUrl throws error', () => {
    const invalid = { events: VALID_CONFIG.events };
    expect(() => configSchema.parse(invalid)).toThrow();
  });

  it('empty events array throws error', () => {
    const invalid = { ...VALID_CONFIG, events: [] };
    expect(() => configSchema.parse(invalid)).toThrow();
  });

  it('invalid URL throws error', () => {
    const invalid = { ...VALID_CONFIG, events: [{ url: 'not-a-url', name: 'Test' }] };
    expect(() => configSchema.parse(invalid)).toThrow();
  });

  it('pollIntervalMs defaults to 60000 when omitted', () => {
    const configWithoutInterval = {
      events: VALID_CONFIG.events,
      discordWebhookUrl: VALID_CONFIG.discordWebhookUrl,
    };
    const result = configSchema.parse(configWithoutInterval);
    expect(result.pollIntervalMs).toBe(60000);
  });
});

describe('loadConfig', () => {
  const testPath = '/tmp/test-config.json';

  it('non-existent file throws error', () => {
    expect(() => loadConfig('/non/existent/path.json')).toThrow();
  });

  it('loads valid config file successfully', () => {
    writeFileSync(testPath, JSON.stringify(VALID_CONFIG));
    const config = loadConfig(testPath);
    expect(config.events).toHaveLength(1);
    expect(config.pollIntervalMs).toBe(60000);
    unlinkSync(testPath);
  });
});