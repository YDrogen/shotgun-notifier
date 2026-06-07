#!/usr/bin/env bun
/**
 * Playwright Validation Gate
 */


import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';

const EVENT_URL = 'https://shotgun.live/en/events/opa-festa-junina-june-7-2026';
const REPORT_PATH = 'VALIDATION-GATE-REPORT.md';
const EVIDENCE_DIR = '.sisyphus/evidence';

interface NetworkLog {
  url: string;
  status: number;
  contentType: string | null;
  jsonPreview?: string;
  error?: string;
}

interface ValidationResult {
  botDetected: boolean;
  botDetectionReason?: string;
  responseCode: number;
  networkLogs: NetworkLog[];
  nextDataFound: boolean;
  nextDataPreview?: string;
  ticketTextsFound: string[];
  selectorsFound: Record<string, number>;
  loadTimeMs: number;
  errors: string[];
  pageTitle: string;
  pageContentLength: number;
}

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function runValidation(headless: boolean): Promise<ValidationResult> {
  const result: ValidationResult = {
    botDetected: false,
    responseCode: 0,
    networkLogs: [],
    nextDataFound: false,
    ticketTextsFound: [],
    selectorsFound: {},
    loadTimeMs: 0,
    errors: [],
    pageTitle: '',
    pageContentLength: 0,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    log(`Launching browser (headless=${headless})...`);
    browser = await chromium.launch({
      headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });

    page = await context.newPage();

    page.on('response', async (response) => {
      const url = response.url();
      const status = response.status();
      const contentType = response.headers()['content-type'] || null;

      if (/shotgun|api|ticket/i.test(url)) {
        const logEntry: NetworkLog = {
          url,
          status,
          contentType,
        };

        if (contentType?.includes('application/json') || contentType?.includes('text/x-component')) {
          try {
            const text = await response.text();
            logEntry.jsonPreview = text.slice(0, 500);
          } catch {
            logEntry.error = 'Failed to read response body';
          }
        }

        result.networkLogs.push(logEntry);
      }
    });

    const startTime = Date.now();
    log(`Navigating to ${EVENT_URL}...`);

    const response = await page.goto(EVENT_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    result.loadTimeMs = Date.now() - startTime;
    result.responseCode = response?.status() ?? 0;

    log(`Page loaded in ${result.loadTimeMs}ms (status: ${result.responseCode})`);

    const pageContent = await page.content();
    result.pageContentLength = pageContent.length;

    if (result.responseCode === 403 || result.responseCode === 429) {
      result.botDetected = true;
      result.botDetectionReason = `HTTP ${result.responseCode} response`;
    } else if (result.responseCode >= 400) {
      result.botDetected = true;
      result.botDetectionReason = `HTTP ${result.responseCode} error response`;
    } else if (pageContent.length < 1000) {
      result.botDetected = true;
      result.botDetectionReason = 'Page content unusually short (< 1000 chars), possible blocking page';
    }

    result.pageTitle = await page.title();
    log(`Page title: ${result.pageTitle}`);

    log('Searching for __NEXT_DATA__...');
    const nextData = await page.evaluate(() => {
      const el = document.getElementById('__NEXT_DATA__');
      if (!el) return null;
      try {
        return JSON.parse(el.textContent || '{}');
      } catch {
        return null;
      }
    });

    if (nextData) {
      result.nextDataFound = true;
      const ticketKeys = Object.keys(nextData).filter((k) =>
        /ticket|price|availability|event|venue|sale/i.test(k),
      );
      result.nextDataPreview = `Found keys: ${ticketKeys.join(', ')}`;
      log(`__NEXT_DATA__ found. Relevant keys: ${ticketKeys.join(', ')}`);
    } else {
      log('__NEXT_DATA__ NOT found');
    }

    log('Searching DOM for ticket-related elements...');

    const selectorPatterns = [
      '[class*="ticket"]',
      '[class*="button"]',
      '[class*="disabled"]',
      '[class*="price"]',
      '[class*="buy"]',
      '[class*="sold"]',
      '[class*="available"]',
      '[class*="waiting"]',
    ];

    for (const selector of selectorPatterns) {
      try {
        const elements = await page.locator(selector).all();
        result.selectorsFound[selector] = elements.length;
        log(`Selector ${selector}: ${elements.length} elements`);
      } catch (err) {
        result.errors.push(`Selector ${selector} error: ${String(err)}`);
      }
    }

    log('Searching for ticket-related text patterns...');
    const ticketTexts = await page.evaluate(() => {
      const patterns = ['Sold out', 'Available', 'Buy', 'Waiting list', '€', '£', '$'];
      const found: string[] = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim() ?? '';
        if (patterns.some((p) => text.toLowerCase().includes(p.toLowerCase()))) {
          found.push(text.slice(0, 100));
        }
      }
      return [...new Set(found)].slice(0, 20);
    });

    result.ticketTextsFound = ticketTexts;
    log(`Found ${ticketTexts.length} ticket-related text snippets`);

  } catch (error) {
    const errorMsg = String(error);
    result.errors.push(errorMsg);
    log(`ERROR: ${errorMsg}`);

    if (errorMsg.includes('net::ERR_BLOCKED_BY_CLIENT') || errorMsg.includes('net::ERR_ACCESS_DENIED')) {
      result.botDetected = true;
      result.botDetectionReason = errorMsg;
    }
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }

  return result;
}

function generateReport(result: ValidationResult): string {
  const lines: string[] = [];

  lines.push('# Validation Gate Report');
  lines.push('');
  lines.push(`**URL**: ${EVENT_URL}`);
  lines.push(`**Date**: ${new Date().toISOString()}`);
  lines.push(`**Browser**: Playwright Chromium (headless)`);
  lines.push('');

  lines.push('## Bot Detection Status');
  lines.push('');
  if (result.botDetected) {
    lines.push('**BLOCKED: YES**');
    lines.push(`**Reason**: ${result.botDetectionReason ?? 'Unknown'}`);
    lines.push(`**Response Code**: ${result.responseCode}`);
  } else {
    lines.push('**BLOCKED: NO**');
    lines.push('Vanilla Playwright headless was NOT detected/blocked.');
    lines.push(`**Response Code**: ${result.responseCode}`);
  }
  lines.push('');

  lines.push('## Network Endpoints');
  lines.push('');
  if (result.networkLogs.length === 0) {
    lines.push('*No network responses matched the filter (shotgun, api, ticket).');
  } else {
    lines.push(`Discovered ${result.networkLogs.length} relevant network responses:`);
    lines.push('');
    for (const log of result.networkLogs) {
      lines.push(`- **URL**: \`${log.url}\``);
      lines.push(`  - Status: ${log.status}`);
      lines.push(`  - Content-Type: ${log.contentType ?? 'unknown'}`);
      if (log.jsonPreview) {
        lines.push(`  - JSON Preview: \`\`\`json`);
        lines.push(`    ${log.jsonPreview}`);
        lines.push(`    \`\`\``);
      }
      if (log.error) {
        lines.push(`  - Error: ${log.error}`);
      }
      lines.push('');
    }
  }
  lines.push('');

  lines.push('## DOM Detection Strategy');
  lines.push('');
  lines.push(`**Page Title**: "${result.pageTitle}"`);
  lines.push(`**Page Content Length**: ${result.pageContentLength} characters`);
  lines.push(`**Load Time**: ${result.loadTimeMs}ms`);
  lines.push('');

  lines.push('### __NEXT_DATA__');
  if (result.nextDataFound) {
    lines.push('**Found**: YES');
    lines.push(`**Preview**: ${result.nextDataPreview ?? 'N/A'}`);
  } else {
    lines.push('**Found**: NO');
  }
  lines.push('');

  lines.push('### Partial Class Selectors');
  lines.push('');
  for (const [selector, count] of Object.entries(result.selectorsFound)) {
    lines.push(`- \`${selector}\`: ${count} elements`);
  }
  lines.push('');

  lines.push('### Ticket-Related Text Found');
  lines.push('');
  if (result.ticketTextsFound.length === 0) {
    lines.push('*No ticket-related text patterns found in DOM.*');
  } else {
    for (const text of result.ticketTextsFound) {
      lines.push(`- "${text}"`);
    }
  }
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  if (result.botDetected) {
    lines.push('1. **Bot detection is ACTIVE.** Do NOT proceed with vanilla Playwright for production scraping.');
    lines.push('2. Consider using `playwright-extra` with stealth plugins, OR switch to network-only interception via external API.');
    lines.push('3. If proceeding with DOM scraping, use headed mode with real user interaction simulation.');
  } else {
    lines.push('1. **No bot detection detected.** Vanilla Playwright headless is viable for initial scraping.');
    if (result.networkLogs.length > 0) {
      lines.push('2. **Network interception strategy**: Monitor the discovered API endpoints for ticket availability data.');
    }
    if (result.nextDataFound) {
      lines.push('3. **__NEXT_DATA__ strategy**: Parse the Next.js hydration data for structured ticket/availability info.');
    }
    if (Object.values(result.selectorsFound).some((c) => c > 0)) {
      lines.push('4. **DOM fallback strategy**: Use partial class selectors combined with text content analysis for ticket status.');
    }
    lines.push('5. **Recommended primary strategy**: Combine network interception (for real-time data) + __NEXT_DATA__ parsing (for structured data) + DOM text fallback (for resilience).');
  }
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const err of result.errors) {
      lines.push(`- ${err}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

async function main() {
  log('=== Shotgun Validation Gate ===');
  log(`Target URL: ${EVENT_URL}`);

  mkdirSync(EVIDENCE_DIR, { recursive: true });

  log('Attempt 1: Headless mode');
  let result = await runValidation(true);

  if (result.botDetected) {
    log('Bot detected in headless mode. Attempting headed mode...');
    result = await runValidation(false);
  }

  log('Generating report...');
  const report = generateReport(result);
  writeFileSync(REPORT_PATH, report, 'utf-8');
  log(`Report saved to ${REPORT_PATH}`);

  const evidencePath = `${EVIDENCE_DIR}/task-4-validation-report.md`;
  writeFileSync(evidencePath, report, 'utf-8');
  log(`Evidence saved to ${evidencePath}`);

  log('');
  log('=== SUMMARY ===');
  log(`Bot Detected: ${result.botDetected ? 'YES' : 'NO'}`);
  log(`Network Endpoints: ${result.networkLogs.length}`);
  log(`__NEXT_DATA__: ${result.nextDataFound ? 'FOUND' : 'NOT FOUND'}`);
  log(`Ticket Text Snippets: ${result.ticketTextsFound.length}`);
  log(`Load Time: ${result.loadTimeMs}ms`);
  log(`Errors: ${result.errors.length}`);
  log('');
  log('Validation gate complete.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
