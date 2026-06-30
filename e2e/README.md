# BlastyBiz E2E Tests

Playwright end-to-end tests for [https://blastybiz-9523e.web.app](https://blastybiz-9523e.web.app).

## Prerequisites

- Node.js 18+
- The `PLAYWRIGHT_TEST_PASSWORD` environment variable (password for `playwright@blastybiz.dev`)

## Setup

```bash
cd e2e
npm install
npx playwright install chromium
```

## Run

```bash
# headless (default)
npm test

# headed — see the browser
npm run test:headed

# view HTML report after a run
npm run report
```

## Test suites

| File | What it covers |
|------|----------------|
| `tests/button-styles.spec.js` | Dashboard, Connect, and BizContext page buttons — border-radius 10px, DM Sans font, green fill on primary/connect variants. Regression guard for the CSS shared-base consolidation (Task #29). |

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `PLAYWRIGHT_TEST_EMAIL` | No | `playwright@blastybiz.dev` |
| `PLAYWRIGHT_TEST_PASSWORD` | **Yes** | — |
