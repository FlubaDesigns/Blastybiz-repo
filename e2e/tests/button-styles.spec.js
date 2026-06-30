// @ts-check
/**
 * Button-styles regression test — Task #29
 *
 * After the CSS consolidation that standardised shared-base properties
 * (border-radius: 10px, font-family: DM Sans, cursor, transition) across every
 * button class, this test verifies that the Dashboard, Connect, and BizContext
 * pages still render their buttons correctly when accessed as an authenticated user.
 *
 * Covered selectors
 * -----------------
 *  Dashboard  : .btn, .btn.btn-primary
 *  Connect    : .btn-proceed, .btn-connect (dynamic)
 *               .btn-reconnect / .btn-disconnect checked when present
 *  BizContext : first <button> found (covers .pir-save-btn and similar)
 *
 * Auth
 * ----
 *  Firebase Email/Password.  Credentials come from env vars:
 *    PLAYWRIGHT_TEST_EMAIL    — defaults to playwright@blastybiz.dev
 *    PLAYWRIGHT_TEST_PASSWORD — required (set in Replit Secrets as PLAYWRIGHT_TEST_PASSWORD)
 */

import { test, expect } from '@playwright/test';

const BASE = 'https://blastybiz-9523e.web.app';
const EMAIL    = process.env.PLAYWRIGHT_TEST_EMAIL    ?? 'playwright@blastybiz.dev';
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? '';

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns computed CSS property values for a selector via page.evaluate.
 * @param {import('@playwright/test').Page} page
 * @param {string} selector CSS selector
 * @param {string[]} props  CSS property names (camelCase or kebab-case both work)
 * @returns {Promise<Record<string, string>>}
 */
async function getComputedProps(page, selector, props) {
  return page.evaluate(
    ({ sel, props }) => {
      const el = document.querySelector(sel);
      if (!el) return {};
      const cs = window.getComputedStyle(el);
      return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]));
    },
    { sel: selector, props }
  );
}

/** Wait for auth-guard to make the body visible (Firebase auth check completes). */
async function waitForBodyVisible(page) {
  await page.waitForFunction(
    () => window.getComputedStyle(document.body).visibility === 'visible',
    { timeout: 20_000 }
  );
}

// ── login fixture ─────────────────────────────────────────────────────────────

/**
 * Logs in once via the Firebase Email/Password form and returns a storage-state
 * object that subsequent tests can reuse to skip re-authentication.
 */
async function login(page) {
  await page.goto(`${BASE}/BlastyBiz-Login.html`);

  // The page starts with visibility:hidden; wait until Firebase sets it visible.
  await waitForBodyVisible(page);

  // Fill the Sign-In tab (first tab is active by default).
  await page.fill('#si-email',    EMAIL);
  await page.fill('#si-password', PASSWORD);

  // The sign-in submit button is either .btn-submit or the first submit-type
  // button inside the sign-in panel.
  const submitBtn = page.locator('.sign-in-col .btn-submit, .sign-in-col button[type="submit"]').first();
  await submitBtn.click();

  // After successful auth, Firebase auth-guard redirects to Dashboard.
  await page.waitForURL(/BlastyBiz-Dashboard\.html/, { timeout: 20_000 });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Button-style regression after CSS consolidation', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────
  test('Dashboard — .btn and .btn-primary have correct shared-base styles', async ({ page }) => {
    await page.goto(`${BASE}/BlastyBiz-Dashboard.html`);
    await waitForBodyVisible(page);

    // At least one .btn element must be present.
    const btnCount = await page.locator('.btn').count();
    expect(btnCount, 'Dashboard should have at least one .btn element').toBeGreaterThan(0);

    // Shared-base: border-radius 10px, DM Sans font-family.
    const btnStyles = await getComputedProps(page, '.btn', ['border-radius', 'font-family']);
    expect(btnStyles['border-radius'],
      '.btn border-radius should be 10px (shared-base rule)').toBe('10px');
    expect(btnStyles['font-family'],
      '.btn font-family should include DM Sans').toContain('DM Sans');

    // .btn-primary should have a green background.
    const primaryStyles = await getComputedProps(
      page,
      '.btn.btn-primary',
      ['background-color', 'border-radius', 'font-family']
    );
    // --green resolves to rgb(0, 200, 83).
    expect(primaryStyles['background-color'],
      '.btn-primary should have a green (#00c853) background').toMatch(/0,\s*200,\s*83/);
    expect(primaryStyles['border-radius'],
      '.btn-primary border-radius should be 10px').toBe('10px');
    expect(primaryStyles['font-family'],
      '.btn-primary font-family should include DM Sans').toContain('DM Sans');
  });

  // ── Connect ────────────────────────────────────────────────────────────────
  test('Connect page — .btn-proceed has correct shared-base styles', async ({ page }) => {
    await page.goto(`${BASE}/BlastyBiz-Connect.html`);
    await waitForBodyVisible(page);

    // The explainer section may be hidden until the user clicks Connect.
    // Force it visible so we can inspect #btn-proceed-google regardless.
    await page.evaluate(() => {
      const el = document.getElementById('explainer-google');
      if (el) {
        el.style.display = 'block';
        el.classList.remove('hidden');
      }
    });

    // #btn-proceed-google must exist in the DOM.
    const proceedBtn = page.locator('#btn-proceed-google');
    await expect(proceedBtn, '#btn-proceed-google must be present in the DOM').toBeAttached();

    const proceedStyles = await getComputedProps(
      page,
      '#btn-proceed-google',
      ['border-radius', 'font-family', 'background-color', 'font-weight', 'cursor']
    );
    expect(proceedStyles['border-radius'],
      '.btn-proceed border-radius should be 10px').toBe('10px');
    expect(proceedStyles['font-family'],
      '.btn-proceed font-family should include DM Sans').toContain('DM Sans');
    expect(proceedStyles['background-color'],
      '.btn-proceed should have a green background').toMatch(/0,\s*200,\s*83/);
    expect(proceedStyles['cursor'],
      '.btn-proceed cursor should be pointer').toBe('pointer');
  });

  test('Connect page — dynamically injected .btn-connect has shared-base styles', async ({ page }) => {
    await page.goto(`${BASE}/BlastyBiz-Connect.html`);
    await waitForBodyVisible(page);

    // Wait for the JS to finish updating platform-action areas.
    // The page calls an API to check connection status; allow up to 10 s.
    await page.waitForTimeout(3_000);

    const connectBtns = page.locator('.btn-connect');
    const count = await connectBtns.count();

    if (count === 0) {
      // Platform already connected — .btn-connect is replaced by reconnect/disconnect.
      // This is acceptable; skip rather than fail.
      test.skip(true, 'No .btn-connect in DOM (platform may already be connected)');
    }

    const styles = await getComputedProps(page, '.btn-connect', ['border-radius', 'font-family', 'background-color']);
    expect(styles['border-radius'],
      '.btn-connect border-radius should be 10px').toBe('10px');
    expect(styles['font-family'],
      '.btn-connect font-family should include DM Sans').toContain('DM Sans');
    expect(styles['background-color'],
      '.btn-connect should have a green background').toMatch(/0,\s*200,\s*83/);
  });

  test('Connect page — .btn-reconnect and .btn-disconnect checked when present', async ({ page }) => {
    await page.goto(`${BASE}/BlastyBiz-Connect.html`);
    await waitForBodyVisible(page);
    await page.waitForTimeout(3_000);

    const reconnectCount = await page.locator('.btn-reconnect').count();
    const disconnectCount = await page.locator('.btn-disconnect').count();

    if (reconnectCount === 0 && disconnectCount === 0) {
      test.skip(true, 'No .btn-reconnect or .btn-disconnect in DOM (no connected platform in test account)');
    }

    if (reconnectCount > 0) {
      const r = await getComputedProps(page, '.btn-reconnect', ['border-radius', 'font-family', 'background-color', 'cursor']);
      expect(r['border-radius'], '.btn-reconnect border-radius should be 10px').toBe('10px');
      expect(r['font-family'],   '.btn-reconnect font-family should include DM Sans').toContain('DM Sans');
      expect(r['cursor'],        '.btn-reconnect cursor should be pointer').toBe('pointer');
    }

    if (disconnectCount > 0) {
      const d = await getComputedProps(page, '.btn-disconnect', ['border-radius', 'font-family', 'background-color', 'cursor']);
      expect(d['border-radius'], '.btn-disconnect border-radius should be 10px').toBe('10px');
      expect(d['font-family'],   '.btn-disconnect font-family should include DM Sans').toContain('DM Sans');
      expect(d['cursor'],        '.btn-disconnect cursor should be pointer').toBe('pointer');
    }
  });

  // ── BizContext ─────────────────────────────────────────────────────────────
  test('BizContext page — action buttons have shared-base styles', async ({ page }) => {
    await page.goto(`${BASE}/BlastyBiz-BizContext.html`);
    await waitForBodyVisible(page);

    // BizContext has at minimum a Save Story button; wait for it.
    const btnLocator = page.locator('button').first();
    await expect(btnLocator, 'BizContext page must have at least one button').toBeAttached();

    const styles = await getComputedProps(page, 'button', ['border-radius', 'font-family', 'cursor']);
    expect(styles['border-radius'],
      'BizContext button border-radius should be 10px (shared-base rule)').toBe('10px');
    expect(styles['font-family'],
      'BizContext button font-family should include DM Sans').toContain('DM Sans');
    expect(styles['cursor'],
      'BizContext button cursor should be pointer').toBe('pointer');
  });
});
