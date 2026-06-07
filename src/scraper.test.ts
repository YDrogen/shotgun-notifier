import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { initBrowser, closeBrowser, scrapeEvent } from './scraper.ts';

const TEST_URL = 'https://shotgun.live/en/events/test-event';

function createMockResponse(overrides: Partial<MockResponse> = {}): MockResponse {
  return {
    status: () => 200,
    headers: () => ({ 'content-type': 'text/html' }),
    text: async () => '',
    ...overrides,
  };
}

interface MockResponse {
  status: () => number;
  headers: () => Record<string, string>;
  text: () => Promise<string>;
}

interface MockRoute {
  request: () => { resourceType: () => string };
  abort: (reason: string) => void;
  continue: () => void;
}

function createMockPage(overrides: Partial<MockPage> = {}): MockPage {
  const responseHandlers: Array<(response: MockResponse) => void | Promise<void>> = [];
  const routes: Array<{ pattern: string; handler: (route: MockRoute) => void }> = [];

  const mockPage: MockPage = {
    on: (_event: string, handler: (response: MockResponse) => void | Promise<void>) => {
      responseHandlers.push(handler);
    },
    route: (pattern: string, handler: (route: MockRoute) => void) => {
      routes.push({ pattern, handler });
    },
    goto: async (_url: string, _options?: unknown) => {
      if (mockPage._responseToEmit) {
        await mockPage._emitResponse(mockPage._responseToEmit);
      }
      return createMockResponse();
    },
    evaluate: async <T>(_fn: () => T) => {
      return '' as unknown as T;
    },
    _responseHandlers: responseHandlers,
    _routes: routes,
    _emitResponse: async (response: MockResponse) => {
      for (const handler of responseHandlers) {
        await handler(response);
      }
    },
    _triggerRoute: (resourceType: string) => {
      for (const { handler } of routes) {
        const route: MockRoute = {
          request: () => ({ resourceType: () => resourceType }),
          abort: (reason: string) => { mockPage._aborted.push(reason); },
          continue: () => { mockPage._continued.push(resourceType); },
        };
        handler(route);
      }
    },
    _aborted: [],
    _continued: [],
    _responseToEmit: null,
    ...overrides,
  };

  return mockPage;
}

interface MockPage {
  on: (event: string, handler: (response: MockResponse) => void | Promise<void>) => void;
  route: (pattern: string, handler: (route: MockRoute) => void) => void;
  goto: (url: string, options?: unknown) => Promise<MockResponse>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  _responseHandlers: Array<(response: MockResponse) => void | Promise<void>>;
  _routes: Array<{ pattern: string; handler: (route: MockRoute) => void }>;
  _emitResponse: (response: MockResponse) => Promise<void>;
  _triggerRoute: (resourceType: string) => void;
  _aborted: string[];
  _continued: string[];
  _responseToEmit: MockResponse | null;
}

function createMockContext(pages: MockPage[] = []): MockContext {
  return {
    newPage: async () => {
      const page = pages.shift() ?? createMockPage();
      return page;
    },
    close: async () => {},
    _pages: pages,
  };
}

interface MockContext {
  newPage: () => Promise<MockPage>;
  close: () => Promise<void>;
  _pages: MockPage[];
}

function createMockBrowser(contexts: MockContext[] = []): MockBrowser {
  return {
    newContext: async () => {
      const context = contexts.shift() ?? createMockContext();
      return context;
    },
    close: async () => {},
    _contexts: contexts,
  };
}

interface MockBrowser {
  newContext: () => Promise<MockContext>;
  close: () => Promise<void>;
  _contexts: MockContext[];
}

describe('scraper', () => {
  let mockBrowser: MockBrowser | null = null;
  let launchedBrowsers: MockBrowser[] = [];

  beforeEach(() => {
    launchedBrowsers = [];
    mockBrowser = null;

    mock.module('playwright', () => ({
      chromium: {
        launch: async () => {
          const browser = createMockBrowser();
          launchedBrowsers.push(browser);
          mockBrowser = browser;
          return browser;
        },
      },
    }));
  });

  afterEach(async () => {
    await closeBrowser();
    mock.module('playwright', () => ({
      chromium: {
        launch: async () => createMockBrowser(),
      },
    }));
  });

  describe('initBrowser', () => {
    it('launches a new browser instance', async () => {
      const browser = await initBrowser();
      expect(browser).toBeDefined();
      expect(launchedBrowsers.length).toBe(1);
    });

    it('returns existing instance on subsequent calls', async () => {
      const first = await initBrowser();
      const second = await initBrowser();
      expect(first).toBe(second);
      expect(launchedBrowsers.length).toBe(1);
    });
  });

  describe('closeBrowser', () => {
    it('closes the browser and resets shared state', async () => {
      await initBrowser();
      await closeBrowser();
      const next = await initBrowser();
      expect(launchedBrowsers.length).toBe(2);
      expect(next).not.toBe(launchedBrowsers[0]);
    });

    it('is safe to call when no browser is open', async () => {
      await expect(closeBrowser()).resolves.toBeUndefined();
    });
  });

  describe('scrapeEvent', () => {
    it('returns state from flight data when available (sold out)', async () => {
      const flightData = JSON.stringify({
        data: {
          event: {
            isSoldOut: true,
            isWaitingListAvailable: false,
            deals: [
              { title: 'Early Bird', price: 25, quantityLeft: 0 },
              { title: 'Regular', price: 35, quantityLeft: 10 },
            ],
          },
        },
      });

      const mockResponse = createMockResponse({
        status: () => 200,
        headers: () => ({ 'content-type': 'text/x-component' }),
        text: async () => flightData,
      });

      const page = createMockPage({
        _responseToEmit: mockResponse,
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('sold_out');
      expect(result.categories).toHaveLength(2);
      expect(result.categories[0]).toEqual({ name: 'Early Bird', status: 'sold_out', price: '€25' });
      expect(result.categories[1]).toEqual({ name: 'Regular', status: 'available', price: '€35' });
      expect(result.raw).toBeDefined();
    });

    it('returns state from flight data when available (not sold out)', async () => {
      const flightData = JSON.stringify({
        data: {
          event: {
            isSoldOut: false,
            isWaitingListAvailable: false,
            deals: [
              { title: 'VIP', price: 100, quantityLeft: 5 },
            ],
          },
        },
      });

      const mockResponse = createMockResponse({
        status: () => 200,
        headers: () => ({ 'content-type': 'text/x-component' }),
        text: async () => flightData,
      });

      const page = createMockPage({
        _responseToEmit: mockResponse,
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('available');
      expect(result.categories).toHaveLength(1);
      expect(result.categories[0]).toEqual({ name: 'VIP', status: 'available', price: '€100' });
    });

    it('falls back to DOM text patterns when no flight data', async () => {
      const page = createMockPage({
        goto: async () => createMockResponse({ status: () => 200 }),
        evaluate: async <T>(_fn: () => T) => {
          return 'Sold out\nNo tickets available\n€25\n€50' as unknown as T;
        },
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('sold_out');
      expect(result.categories.length).toBeGreaterThan(0);
      expect(result.categories[0].status).toBe('sold_out');
    });

    it('returns unknown on 429 rate limit', async () => {
      const page = createMockPage({
        goto: async () => createMockResponse({ status: () => 429 }),
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('unknown');
      expect(result.categories).toEqual([]);
    });

    it('returns unknown on HTTP 500 error', async () => {
      const page = createMockPage({
        goto: async () => createMockResponse({ status: () => 500 }),
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('unknown');
      expect(result.categories).toEqual([]);
    });

    it('returns unknown on page.goto timeout', async () => {
      const page = createMockPage({
        goto: async () => {
          throw new Error('Timeout 30000ms exceeded');
        },
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('unknown');
      expect(result.categories).toEqual([]);
    });

    it('returns unknown on network error', async () => {
      const page = createMockPage({
        goto: async () => {
          throw new Error('net::ERR_CONNECTION_REFUSED');
        },
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      const result = await scrapeEvent(TEST_URL);

      expect(result.state).toBe('unknown');
      expect(result.categories).toEqual([]);
    });

    it('blocks images, CSS, and fonts', async () => {
      const page = createMockPage({
        goto: async () => createMockResponse({ status: () => 200 }),
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      await scrapeEvent(TEST_URL);

      page._triggerRoute('image');
      page._triggerRoute('stylesheet');
      page._triggerRoute('font');
      page._triggerRoute('xhr');

      expect(page._aborted.length).toBeGreaterThan(0);
    });

    it('creates and closes context per scrape call', async () => {
      let closeCalled = false;
      const page = createMockPage({
        goto: async () => createMockResponse({ status: () => 200 }),
      });

      const context = createMockContext([page]);
      context.close = async () => {
        closeCalled = true;
      };

      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      await scrapeEvent(TEST_URL);

      expect(closeCalled).toBe(true);
    });

    it('never throws for expected failures', async () => {
      const page = createMockPage({
        goto: async () => {
          throw new Error('Unexpected failure');
        },
      });

      const context = createMockContext([page]);
      const browser = createMockBrowser([context]);
      launchedBrowsers.push(browser);
      mockBrowser = browser;

      mock.module('playwright', () => ({
        chromium: {
          launch: async () => browser,
        },
      }));

      await expect(scrapeEvent(TEST_URL)).resolves.toEqual({ state: 'unknown', categories: [] });
    });
  });
});
