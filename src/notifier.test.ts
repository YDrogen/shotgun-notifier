import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { sendNotification, sendUnhealthyAlert, validateWebhookUrl } from './notifier.ts';

const TEST_WEBHOOK = 'https://discord.com/api/webhooks/test/webhook';
const TEST_EVENT = { name: 'Test Event', url: 'https://example.com/event' };
const TEST_STATUS = { state: 'Available', categories: { Price: '$50', Section: 'A1' } };
const TEST_EVENT_WITH_CATS = { name: 'Test Event', url: 'https://example.com/event', categories: ['Price', 'Section'] };

let capturedCalls: { url: string; options: RequestInit }[] = [];

describe('notifier', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    capturedCalls = [];
    globalThis.fetch = async (url: string, options: RequestInit) => {
      capturedCalls.push({ url: url as string, options });
      return new Response('', { status: 204 });
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendNotification', () => {
    it('sends correct embed structure to Discord webhook', async () => {
      await sendNotification(TEST_WEBHOOK, TEST_EVENT_WITH_CATS, TEST_STATUS);

      expect(capturedCalls.length).toBe(1);
      expect(capturedCalls[0].url).toBe(TEST_WEBHOOK);
      expect(capturedCalls[0].options.method).toBe('POST');
      expect(capturedCalls[0].options.headers).toEqual({ 'Content-Type': 'application/json' });

      const body = JSON.parse(capturedCalls[0].options.body as string);
      expect(body.embeds).toHaveLength(1);
      expect(body.embeds[0]).toMatchObject({
        title: 'Test Event',
        description: 'Available',
        url: 'https://example.com/event',
        fields: [
          { name: 'Price', value: '$50', inline: true },
          { name: 'Section', value: 'A1', inline: true },
        ],
      });
    });

    it('handles 200 status as success', async () => {
      globalThis.fetch = async () => new Response('', { status: 200 });
      await expect(sendNotification(TEST_WEBHOOK, TEST_EVENT, TEST_STATUS)).resolves.toBeUndefined();
    });

    it('handles rate limit (429) gracefully', async () => {
      globalThis.fetch = async () => new Response('', { status: 429 });
      await expect(sendNotification(TEST_WEBHOOK, TEST_EVENT, TEST_STATUS)).resolves.toBeUndefined();
    });

    it('throws on 4xx/5xx errors', async () => {
      globalThis.fetch = async () => new Response('Bad Request', { status: 400 });
      await expect(sendNotification(TEST_WEBHOOK, TEST_EVENT, TEST_STATUS)).rejects.toThrow();
    });

    it('uses green color for Available state', async () => {
      await sendNotification(TEST_WEBHOOK, TEST_EVENT, TEST_STATUS);

      const body = JSON.parse(capturedCalls[0].options.body as string);
      expect(body.embeds[0].color).toBe(3066993);
    });

    it('uses orange color for non-Available state', async () => {
      await sendNotification(TEST_WEBHOOK, TEST_EVENT, { state: 'Sold Out' });

      const body = JSON.parse(capturedCalls[0].options.body as string);
      expect(body.embeds[0].color).toBe(15105570);
    });
  });

  describe('sendUnhealthyAlert', () => {
    it('sends warning embed with failure count', async () => {
      await sendUnhealthyAlert(TEST_WEBHOOK, TEST_EVENT, 5);

      const body = JSON.parse(capturedCalls[0].options.body as string);
      expect(body.embeds[0]).toMatchObject({
        title: '⚠️ Test Event',
        description: 'Failed to fetch after 5 attempts',
      });
    });

    it('handles rate limit without throwing', async () => {
      globalThis.fetch = async () => new Response('', { status: 429 });
      await expect(sendUnhealthyAlert(TEST_WEBHOOK, TEST_EVENT, 3)).resolves.toBeUndefined();
    });
  });

  describe('validateWebhookUrl', () => {
    it('returns true for 200 response', async () => {
      globalThis.fetch = async () => new Response('', { status: 200 });
      const result = await validateWebhookUrl(TEST_WEBHOOK);
      expect(result).toBe(true);
    });

    it('returns true for 204 response', async () => {
      globalThis.fetch = async () => new Response('', { status: 204 });
      const result = await validateWebhookUrl(TEST_WEBHOOK);
      expect(result).toBe(true);
    });

    it('returns false for invalid webhook', async () => {
      globalThis.fetch = async () => new Response('', { status: 400 });
      const result = await validateWebhookUrl(TEST_WEBHOOK);
      expect(result).toBe(false);
    });

    it('returns false on network error', async () => {
      globalThis.fetch = async () => { throw new Error('Network error'); };
      const result = await validateWebhookUrl(TEST_WEBHOOK);
      expect(result).toBe(false);
    });
  });
});