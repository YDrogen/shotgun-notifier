# Shotgun Ticket Monitor

## TL;DR

> **Quick Summary**: Build a Bun/TypeScript CLI app that monitors Shotgun event pages for ticket availability using headless Playwright, and sends Discord webhook notifications on status changes.
>
> **Deliverables**:
> - Working CLI app that polls Shotgun event pages at configurable intervals
> - Discord webhook notifications on ticket status changes
> - JSON config file for event URLs, poll interval, and webhook URL
> - Graceful shutdown, error recovery, and exponential backoff
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 4 → Task 6 → Task 7 → Task 8

---

## Context

### Original Request
User wants a simple TypeScript app to monitor a Shotgun event page. When tickets become available, they want to be notified via Discord webhook.

### Interview Summary
**Key Discussions**:
- **Notification**: Discord webhook (simple HTTP POST, no library needed beyond native fetch)
- **Poll interval**: Every 1 minute, configurable via config
- **Target events**: JSON config file supporting multiple event URLs
- **Re-notification**: On status change only (sold_out → available = notify; available → available = no notify)
- **Runtime**: Bun (fast startup, native TypeScript, built-in test runner)
- **Process model**: Long-lived process with setInterval

**Research Findings**:
- Shotgun.live uses Next.js on Vercel with client-side rendering — must use headless browser
- NO public buyer API — must scrape
- Vercel deploy has bot protection (429 responses) — need stealth/anti-detection
- Existing `shotgun-monitor` uses Puppeteer with hardcoded CSS classes like `css-5ox9as` — WILL break
- Existing `shotgun-notifier` uses organizer API (requires JWT, not available to buyers)
- Playwright recommended over Puppeteer (auto-wait, multi-browser, better ergonomics)

### Metis Review
**Identified Gaps** (addressed):
- **Validation gate**: Must test Playwright against real Shotgun page before writing scraper code — added as Task 4
- **Status model**: Needs `unknown` state to distinguish "scrape failed" from "sold out" — included in types task
- **Network interception**: Should be primary strategy, DOM as fallback — included in scraper task
- **Browser lifecycle**: Must create/close context per poll to prevent memory leaks — included in orchestrator task
- **First-run behavior**: Must notify on first check to establish baseline — included in state tracker
- **Exponential backoff**: On failures and rate limits — included in orchestrator task
- **Unhealthy alerting**: After 5 consecutive failures, notify via Discord — included in orchestrator task

---

## Work Objectives

### Core Objective
Build a reliable, minimal TypeScript CLI app that monitors Shotgun event pages for ticket availability and sends Discord webhook notifications on status changes.

### Concrete Deliverables
- `src/index.ts` — CLI entry point with graceful shutdown
- `src/config.ts` — Zod-validated config loader
- `src/scraper.ts` — Playwright scraper with network interception + DOM fallback
- `src/state.ts` — In-memory event state tracker
- `src/notifier.ts` — Discord webhook notifier
- `src/orchestrator.ts` — Poll loop with browser lifecycle and backoff
- `src/logger.ts` — Pino structured logger
- `src/types.ts` — TypeScript interfaces and state model
- `config.example.json` — Example configuration file
- `package.json` — Dependencies and scripts
- `tsconfig.json` — TypeScript configuration

### Definition of Done
- [ ] `bun run src/index.ts` starts monitoring with a valid config.json
- [ ] `bun run src/index.ts` exits with code 1 and validation error on invalid config
- [ ] Monitor detects ticket availability status changes on a real Shotgun event page
- [ ] Discord webhook receives rich embed notification on status change
- [ ] No notification sent when status is unchanged between polls
- [ ] Process handles SIGTERM/SIGINT gracefully (completes current poll, exits 0)
- [ ] Process recovers from transient errors (429, timeouts) with exponential backoff
- [ ] Memory usage remains stable over extended run time

### Must Have
- Playwright-based page scraping with network interception as primary strategy
- JSON config with Zod validation (event URLs, webhook URL, poll interval)
- Discord webhook notifications with rich embeds on status changes
- Status model: `available | sold_out | unknown` (unknown = scrape failed)
- First-run notification regardless of status (establish baseline)
- Exponential backoff on failures (1min → 2min → 4min → max 15min)
- Unhealthy monitor alert after 5 consecutive failures per event
- Browser context per poll cycle (never reuse across polls)
- Graceful shutdown on SIGTERM/SIGINT
- Pino structured JSON logging

### Must NOT Have (Guardrails)
- NO ticket purchasing automation — monitoring only
- NO web UI or dashboard — CLI only
- NO Telegram/Slack/SMTP notifications — Discord webhook only
- NO database or file-based persistence — in-memory state only
- NO proxy rotation or CAPTCHA solving in v1
- NO anti-bot circumvention beyond basic Playwright — if blocked, alert and document
- NO Organizer API usage — requires credentials end users don't have
- NO config hot-reload — restart to apply changes
- NO dynamic CSS class name selectors — use network interception + text content
- NO browser context reuse across polls — create new, close after, every time

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: NO (greenfield project)
- **Automated tests**: YES (Bun test, tests-after approach)
- **Framework**: Bun test runner (built into Bun)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **CLI/Process**: Use Bash — run commands, check exit codes, grep output
- **API/Webhook**: Use Bash (curl) — send requests, assert status + response
- **Scraper**: Use Playwright — open page, intercept network, assert DOM content
- **Integration**: Use Bash — run full app, wait, check logs, kill process

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — foundation, all parallel):
├── Task 1: Project scaffolding + dependencies [quick]
├── Task 2: Config schema (Zod) + types + example config [quick]
└── Task 3: Pino logger + Discord notifier [quick]

Wave 2 (After Wave 1 — validation + state):
├── Task 4: Playwright validation gate [deep]
└── Task 5: State tracker [quick]

Wave 3 (After Wave 2 — core implementation, sequential):
├── Task 6: Scraper module [deep]
└── Task 7: Orchestrator (depends on Task 6) [deep]

Wave 4 (After Wave 3 — integration):
└── Task 8: CLI entry point + graceful shutdown + e2e test [unspecified-high]

Wave FINAL (After ALL tasks — verification):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real manual QA (unspecified-high)
└── F4: Scope fidelity check (deep)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1    | —         | 4, 5, 6, 7, 8 | 1 |
| 2    | —         | 5, 8    | 1 |
| 3    | —         | 7, 8    | 1 |
| 4    | 1         | 6, 7    | 2 |
| 5    | 2          | 6, 7    | 2 |
| 6    | 3, 4, 5   | 7, 8    | 3 |
| 7    | 3, 5, 6   | 8       | 3 |
| 8    | 2, 3, 7   | —       | 4 |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 `quick`, T2 `quick`, T3 `quick`
- **Wave 2**: **2** — T4 `deep`, T5 `quick`
- **Wave 3**: **2** — T6 `deep`, T7 `deep`
- **Wave 4**: **1** — T8 `unspecified-high`
- **FINAL**: **4** — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. Project scaffolding + dependencies

  **What to do**:
  - Initialize Bun project: `bun init`, set up `package.json` with name `shotgun-notif`
  - Install dependencies: `playwright`, `zod`, `pino`
  - Install dev dependencies: `@types/node`, `typescript`
  - Add `playwright` binary: `bunx playwright install chromium`
  - Create `tsconfig.json` with strict mode, ESNext target, Bundler module resolution
  - Add scripts to `package.json`: `"start": "bun run src/index.ts"`, `"dev": "bun --watch src/index.ts"`, `"check": "tsc --noEmit"`
  - Create `src/` directory structure (empty placeholder files for each module: `index.ts`, `config.ts`, `scraper.ts`, `state.ts`, `notifier.ts`, `orchestrator.ts`, `logger.ts`, `types.ts`)
  - Verify `bun run src/index.ts` runs without errors (just a console.log placeholder)
  - Verify `bunx playwright install chromium --with-deps` completes successfully

  **Must NOT do**:
  - Do NOT add `puppeteer` or `puppeteer-extra` — we use Playwright only
  - Do NOT add `node-cron` — we use `setInterval` for simplicity
  - Do NOT add `dotenv` — config is in JSON, secrets in env vars via process.env
  - Do NOT add test frameworks yet (beyond Bun's built-in)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 5, 6, 7, 8
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `https://bun.sh/docs/quickstart` — Bun project initialization
  - `https://playwright.dev/docs/intro` — Playwright setup with Bun

  **External References**:
  - Bun docs: `https://bun.sh/docs/quickstart` — Project init and scripts
  - Playwright docs: `https://playwright.dev/docs/intro` — Installation and first script
  - Zod docs: `https://zod.dev` — Schema validation
  - Pino docs: `https://getpino.dev` — Structured JSON logger

  **Acceptance Criteria**:

  - [x] `bun run src/index.ts` executes without errors (placeholder output)
  - [x] `bunx playwright install chromium` completed, Chromium binary available
  - [x] `tsc --noEmit` passes with zero errors
  - [x] `package.json` contains scripts: `start`, `dev`, `check`
  - [x] `.gitignore` includes `node_modules/`, `config.json`, `.env`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Project runs with placeholder entry
    Tool: Bash
    Preconditions: bun installed, project directory is /Users/ydrogen/Workspace/lab/shotgun-notif
    Steps:
      1. Run `bun run src/index.ts`
      2. Check exit code is 0
      3. Check stdout contains expected placeholder text
    Expected Result: Command exits 0, prints placeholder message
    Failure Indicators: Exit code non-zero, import errors, module not found
    Evidence: .sisyphus/evidence/task-1-run-placeholder.txt

  Scenario: Playwright Chromium binary available
    Tool: Bash
    Preconditions: playwright installed, chromium downloaded
    Steps:
      1. Run `npx playwright --version`
      2. Check output contains version number
    Expected Result: Playwright version printed, chromium binary accessible
    Failure Indicators: "browser not found", "exec path not found"
    Evidence: .sisyphus/evidence/task-1-playwright-version.txt

  Scenario: TypeScript compiles without errors
    Tool: Bash
    Preconditions: All .ts files present in src/
    Steps:
      1. Run `bun run check` (or `tsc --noEmit`)
      2. Check exit code is 0
    Expected Result: Zero TypeScript errors
    Failure Indicators: "error TS", type errors, missing declarations
    Evidence: .sisyphus/evidence/task-1-tsc-check.txt
  ```

  **Commit**: YES
  - Message: `feat(init): scaffold project with bun and dependencies`
  - Files: `package.json`, `tsconfig.json`, `.gitignore`, `src/index.ts`
  - Pre-commit: `bun run check`

- [x] 2. Config schema (Zod) + types + example config

  **What to do**:
  - Create `src/types.ts` with TypeScript interfaces:
    - `EventState`: `'available' | 'sold_out' | 'unknown'`
    - `TicketCategory`: `{ name: string; status: EventState; price?: string }`
    - `EventStatus`: `{ url: string; state: EventState; categories: TicketCategory[]; lastChecked: Date; consecutiveFailures: number }`
    - `EventConfig`: `{ url: string; name: string }`
    - `Config`: `{ events: EventConfig[]; discordWebhookUrl: string; pollIntervalMs: number }`
    - `ScrapeResult`: `{ state: EventState; categories: TicketCategory[]; raw?: unknown }`
  - Create `src/config.ts` with Zod schema validation:
    - `eventConfigSchema`: `z.object({ url: z.string().url(), name: z.string().min(1) })`
    - `configSchema`: `z.object({ events: z.array(eventConfigSchema).min(1), discordWebhookUrl: z.string().url(), pollIntervalMs: z.number().int().min(30000).default(60000) })`
    - `loadConfig(path: string)`: Read JSON file, parse with Zod, return typed `Config` or throw with detailed validation errors
  - Create `config.example.json` with:
    - 2 example event URLs (placeholder Shotgun URLs)
    - Placeholder Discord webhook URL
    - `pollIntervalMs: 60000`
  - Add unit tests for config validation (valid config, invalid URL, missing fields, pollInterval too low)

  **Must NOT do**:
  - Do NOT use YAML or TOML — JSON only per user preference
  - Do NOT add `dotenv` — config is JSON file, webhook URL is in config
  - Do NOT make `pollIntervalMs` required — use default of 60000ms
  - Do NOT add file persistence for state — in-memory only

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 5, 8
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - Zod schema pattern: `https://zod.dev/?id=basic-usage` — `.object()`, `.string()`, `.url()`, `.default()`
  - Discriminated union pattern: `https://zod.dev/?id=discriminated-unions` — for event state type

  **External References**:
  - Zod docs: `https://zod.dev` — Schema validation, error handling, defaults

  **Acceptance Criteria**:

  - [x] `bun test src/config.test.ts` passes (valid, invalid, edge cases)
  - [x] `loadConfig('config.example.json')` returns valid `Config` object
  - [x] `loadConfig('nonexistent.json')` throws with clear error message
  - [x] `loadConfig` with invalid URL throws Zod validation error with field details
  - [x] `pollIntervalMs` defaults to 60000 when omitted from config

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Valid config loads successfully
    Tool: Bash
    Preconditions: config.example.json exists with valid structure
    Steps:
      1. Create a test script that imports loadConfig and calls it with config.example.json
      2. Run `bun test src/config.test.ts`
      3. Check all tests pass
    Expected Result: Config object with events array, discordWebhookUrl, pollIntervalMs = 60000
    Failure Indicators: ZodError, missing fields, wrong types
    Evidence: .sisyphus/evidence/task-2-valid-config.txt

  Scenario: Invalid config rejects with clear errors
    Tool: Bash
    Preconditions: config with invalid data
    Steps:
      1. Write a temp config with: missing discordWebhookUrl, pollIntervalMs = 100 (below 30000), events = []
      2. Run test that calls loadConfig on invalid config
      3. Verify ZodError contains specific field errors
    Expected Result: Error messages for each invalid field, exit code 1
    Failure Indicators: Generic "invalid config" without field details
    Evidence: .sisyphus/evidence/task-2-invalid-config.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add zod config schema and types`
  - Files: `src/types.ts`, `src/config.ts`, `config.example.json`
  - Pre-commit: `bun test`

- [x] 3. Pino logger + Discord notifier

  **What to do**:
  - Create `src/logger.ts`:
    - Initialize Pino logger with `pino({ level: 'info' })`
    - Export singleton logger instance
    - Include structured fields: `component` (e.g., 'scraper', 'orchestrator'), `eventId`
  - Create `src/notifier.ts`:
    - `sendNotification(webhookUrl: string, event: EventConfig, status: EventStatus): Promise<void>`
    - Build Discord rich embed with: event name, URL (clickable), current state, ticket categories, timestamp
    - Use native `fetch` (Bun has built-in fetch) — no HTTP library needed
    - Handle Discord API responses: 204 = success, 429 = rate limited (log warning with retry-after), 4xx/5xx = error
    - `sendUnhealthyAlert(webhookUrl: string, event: EventConfig, failureCount: number): Promise<void>` — sends warning embed for 5+ consecutive failures
    - `validateWebhookUrl(url: string): Promise<boolean>` — test POST to webhook, return true if 200/204
  - Add unit tests for notifier (mock fetch with Bun's test utilities)

  **Must NOT do**:
  - Do NOT add `discord.js` — we use raw webhook, not a bot
  - Do NOT add `axios` or `node-fetch` — Bun has native fetch
  - Do NOT add Telegram/Slack/SMTP — Discord only
  - Do NOT send notifications on every poll — only on state change (handled by orchestrator, not notifier)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - Discord webhook docs: `https://discord.com/developers/docs/resources/webhook` — Execute webhook, embed structure
  - Pino docs: `https://getpino.dev` — Logger initialization, child loggers

  **External References**:
  - Discord Webhook API: `https://discord.com/developers/docs/resources/webhook#execute-webhook`
  - Pino: `https://getpino.dev` — Structured JSON logger for Node.js

  **Acceptance Criteria**:

  - [x] `bun test src/notifier.test.ts` passes (success, rate limit, error cases)
  - [x] `sendNotification` sends Discord embed with event name, URL, state, categories, timestamp
  - [x] `sendUnhealthyAlert` sends warning embed with failure count
  - [x] Discord 429 response is handled gracefully with warning log
  - [x] Invalid webhook URL returns false from `validateWebhookUrl`

  **QA Scenarios (MANDATORY)**:

  ```
  Scenario: Discord notification sent successfully
    Tool: Bash (curl)
    Preconditions: A real Discord webhook URL (user will provide), or use a mock server
    Steps:
      1. Run test that calls sendNotification with a test webhook URL and sample event
      2. Verify the Discord channel received a rich embed message
      3. Check embed contains event name, URL, state, timestamp
    Expected Result: HTTP 204 from Discord, message posted to channel
    Failure Indicators: 4xx/5xx response, no message in channel
    Evidence: .sisyphus/evidence/task-3-discord-notification.txt

  Scenario: Discord rate limit handled gracefully
    Tool: Bash (unit test)
    Preconditions: Mock fetch that returns 429 with retry-after header
    Steps:
      1. Run test that simulates Discord 429 response
      2. Verify logger.warn was called with retry-after info
      3. Verify no crash or unhandled error
    Expected Result: Warning logged, no crash, function returns gracefully
    Failure Indicators: Uncaught error, crash, no warning log
    Evidence: .sisyphus/evidence/task-3-rate-limit-handling.txt
  ```

  **Commit**: YES
  - Message: `feat(notify): add pino logger and discord webhook notifier`
  - Files: `src/logger.ts`, `src/notifier.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `bun run check` (tsc + lint). Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Types [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Run `bun run src/index.ts` with a real config.json containing a Shotgun event URL. Verify: startup logs, poll execution, status detection, Discord notification on status change, graceful shutdown on SIGTERM. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT Have" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `feat(init): scaffold project with bun and dependencies`
- **Task 2**: `feat(config): add zod config schema and types`
- **Task 3**: `feat(notify): add pino logger and discord webhook notifier`
- **Task 4**: `chore(validate): playwright validation gate findings`
- **Task 5**: `feat(state): add event state tracker`
- **Task 6**: `feat(scraper): add playwright scraper module`
- **Task 7**: `feat(orchestrator): add poll orchestrator with backoff`
- **Task 8**: `feat(cli): add entry point and graceful shutdown`

---

## Success Criteria

### Verification Commands
```bash
bun run src/index.ts                                    # Starts monitoring
bun run src/index.ts --config nonexistent.json          # Exits 1 with validation error
bun test                                                # All tests pass
curl -X POST "$DISCORD_WEBHOOK" -H "Content-Type: application/json" -d '{"content":"test"}'  # 204 No Content
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Discord notifications sent on status change
- [ ] No notifications on unchanged status
- [ ] Graceful shutdown on SIGTERM
- [ ] Exponential backoff on failures