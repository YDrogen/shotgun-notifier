import { chromium, type Browser, type Page } from 'playwright';
import type { EventState, ScrapeResult, TicketCategory } from './types.ts';
import { createLogger } from './logger.ts';

const log = createLogger('scraper');

let sharedBrowser: Browser | null = null;

export async function initBrowser(): Promise<Browser> {
  if (sharedBrowser) {
    return sharedBrowser;
  }

  log.info('Launching Chromium browser');
  sharedBrowser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  return sharedBrowser;
}

export async function closeBrowser(): Promise<void> {
  if (sharedBrowser) {
    log.info('Closing Chromium browser');
    await sharedBrowser.close();
    sharedBrowser = null;
  }
}

export async function scrapeEvent(url: string): Promise<ScrapeResult> {
  const browser = await initBrowser();
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    locale: 'en-GB',
  });

  const page = await context.newPage();
  let result: ScrapeResult = { state: 'unknown', categories: [] };

  try {
    await page.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
        route.abort('aborted');
      } else {
        route.continue();
      }
    });

    const flightResponses: string[] = [];
    page.on('response', async (response) => {
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('text/x-component')) {
        try {
          const text = await response.text();
          flightResponses.push(text);
        } catch {
          // Ignore unreadable responses
        }
      }
    });

    const gotoResponse = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    const status = gotoResponse?.status() ?? 0;
    if (status === 429) {
      log.warn({ url, status }, 'Rate limited (429), returning unknown state');
      return { state: 'unknown', categories: [] };
    }

    if (status >= 400) {
      log.warn({ url, status }, 'HTTP error response, returning unknown state');
      return { state: 'unknown', categories: [] };
    }

    if (flightResponses.length > 0) {
      result = parseFlightData(flightResponses);
    }

    if (result.state === 'unknown' || result.categories.length === 0) {
      const fallback = await scrapeFromDom(page);
      if (fallback.state !== 'unknown') {
        result.state = fallback.state;
      }
      if (fallback.categories.length > 0) {
        result.categories = fallback.categories;
      }
    }

    log.info({ url, state: result.state, categories: result.categories.length }, 'Scrape complete');
    return result;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    log.error({ url, error: errorMsg }, 'Scrape failed, returning unknown state');
    return { state: 'unknown', categories: [] };
  } finally {
    await context.close();
  }
}

function parseFlightData(responses: string[]): ScrapeResult {
  for (const text of responses) {
    try {
      const lines = text.trim().split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        const eventData = extractEventData(parsed);
        if (eventData) {
          return eventData;
        }
      }
    } catch {
      // Skip unparseable responses
    }
  }

  return { state: 'unknown', categories: [] };
}

function extractEventData(obj: unknown): ScrapeResult | null {
  if (!obj || typeof obj !== 'object') return null;

  const data = (obj as Record<string, unknown>).data;
  if (data && typeof data === 'object') {
    const event = (data as Record<string, unknown>).event;
    if (event && typeof event === 'object') {
      return parseEventObject(event as Record<string, unknown>);
    }
  }

  for (const value of Object.values(obj)) {
    const found = extractEventData(value);
    if (found) return found;
  }

  return null;
}

function parseEventObject(event: Record<string, unknown>): ScrapeResult | null {
  const isSoldOut = event.isSoldOut === true;
  const isWaitingListAvailable = event.isWaitingListAvailable === true;

  let state: EventState;
  if (isSoldOut) {
    state = 'sold_out';
  } else {
    state = 'available';
  }

  const categories: TicketCategory[] = [];
  const deals = event.deals;
  if (Array.isArray(deals)) {
    for (const deal of deals) {
      if (typeof deal === 'object' && deal !== null) {
        const d = deal as Record<string, unknown>;
        const name = typeof d.title === 'string' ? d.title : 'Unknown';
        const quantityLeft = typeof d.quantityLeft === 'number' ? d.quantityLeft : null;
        const price = typeof d.price === 'number' ? `€${d.price}` : undefined;

        let dealState: EventState;
        if (quantityLeft !== null && quantityLeft <= 0) {
          dealState = 'sold_out';
        } else {
          dealState = 'available';
        }

        categories.push({
          name,
          status: dealState,
          price,
        });
      }
    }
  }

  const raw = {
    isSoldOut,
    isWaitingListAvailable,
    deals: categories,
  };

  return { state, categories, raw };
}

async function scrapeFromDom(page: Page): Promise<ScrapeResult> {
  const pageText = await page.evaluate(() => document.body.innerText);
  const lowerText = pageText.toLowerCase();

  let state: EventState = 'unknown';

  if (lowerText.includes('sold out') || lowerText.includes('no tickets available')) {
    state = 'sold_out';
  } else if (lowerText.includes('waiting list')) {
    state = 'sold_out';
  }

  const categories: TicketCategory[] = [];
  const priceMatches = pageText.match(/[€£$]\s?\d+(?:[.,]\d{2})?/g);
  if (priceMatches) {
    for (const price of priceMatches) {
      categories.push({
        name: 'Ticket',
        status: state === 'sold_out' ? 'sold_out' : 'available',
        price,
      });
    }
  }

  return { state, categories };
}
