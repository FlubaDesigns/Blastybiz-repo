// @ts-check
/**
 * Sign-up duplicate-email regression test — Task #86
 *
 * Verifies that when a user attempts to create an account with an email address
 * that already exists in Firebase, the app:
 *   1. Shows an error toast with the exact message "Account already exists — sign in instead"
 *   2. Does NOT redirect away or show the email-verification view
 *   3. Keeps the sign-up form visible and interactive
 *
 * The test uses the existing Playwright test account email, which is guaranteed
 * to already be registered.
 *
 * Auth credentials:
 *   PLAYWRIGHT_TEST_EMAIL    — defaults to playwright@blastybiz.dev
 *   PLAYWRIGHT_TEST_PASSWORD — required (set in Replit Secrets as PLAYWRIGHT_TEST_PASSWORD)
 */

import { test, expect } from '@playwright/test';

const BASE     = 'https://blastybiz-9523e.web.app';
const EMAIL    = process.env.PLAYWRIGHT_TEST_EMAIL    ?? 'playwright@blastybiz.dev';
const PASSWORD = process.env.PLAYWRIGHT_TEST_PASSWORD ?? '';

/**
 * Wait for the auth card to finish its loading spinner and become ready.
 * Firebase's onAuthStateChanged completes and either shows the form or
 * redirects; `ready` class is added in showLoginForm().
 */
async function waitForAuthCardReady(page) {
  await page.waitForSelector('#auth-card-wrap.ready', { timeout: 20_000 });
}

test.describe('Sign-up duplicate-email handling', () => {
  test('shows correct error toast and stays on sign-up form when email already exists', async ({ page }) => {
    // ── 1. Navigate to the login page (no existing session) ──────────────────
    await page.goto(`${BASE}/BlastyBiz-Login.html`);
    await waitForAuthCardReady(page);

    // ── 2. Switch to the Create Account tab ──────────────────────────────────
    await page.click('#tab-signup');

    // Confirm the sign-up form is now the active one.
    await expect(page.locator('#form-signup')).toHaveClass(/active/);

    // ── 3. Fill in the form with an already-registered email ─────────────────
    await page.fill('#su-name',      'Test User');
    await page.fill('#su-email',     EMAIL);           // already registered
    await page.fill('#su-password',  PASSWORD || 'TestPassword1!');
    await page.fill('#su-password2', PASSWORD || 'TestPassword1!');

    // ── 4. Submit ─────────────────────────────────────────────────────────────
    await page.click('#btn-signup');

    // ── 5. Toast must appear with the exact duplicate-email message ───────────
    const toast = page.locator('#toast');
    await expect(toast).toHaveClass(/show/, { timeout: 15_000 });
    await expect(toast).toHaveText('Account already exists — sign in instead');
    // Toast must be styled as an error (red variant)
    await expect(toast).toHaveClass(/error-toast/);

    // ── 6. Must NOT have entered verify-mode (no email-verification screen) ───
    await expect(page.locator('#auth-card-wrap')).not.toHaveClass(/verify-mode/);
    await expect(page.locator('#verify-view')).not.toBeVisible();

    // ── 7. Sign-up form must still be active (no redirect, no tab swap) ───────
    await expect(page.locator('#form-signup')).toHaveClass(/active/);
    await expect(page.locator('#btn-signup')).toBeVisible();

    // ── 8. URL must not have changed away from the login page ─────────────────
    expect(page.url()).toContain('BlastyBiz-Login.html');
  });
});
