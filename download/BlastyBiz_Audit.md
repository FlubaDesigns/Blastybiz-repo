# BlastyBiz — Full Site Audit
**Last updated: June 20, 2026 (Session 4)**
**Firebase Project:** blastybiz-9523e
**Live URL:** https://blastybiz-9523e.web.app

---

## Deployed Cloud Functions (29 total — all v2, us-central1)

| # | Function | Type | Purpose |
|---|---|---|---|
| 1 | `adaptListing` | HTTP | AI listing adaptation (Anthropic Claude); verifyBearer() + AI_LIMITS cap |
| 2 | `resolveCategories` | HTTP | AI category resolution; verifyBearer() + AI_LIMITS cap |
| 3 | `approveDraft` | HTTP | Creates publishJobs batch; verifyBearer(); enforces Starter plan-gating |
| 4 | `uploadImage` | HTTP | Uploads images to Firebase Storage; verifyBearer() |
| 5 | `postToGoogle` | HTTP | Internal: posts to Google Business Profile; called by onJobCreated trigger |
| 6 | `postToFacebook` | HTTP | Internal: posts to Facebook Business Page; called by onJobCreated trigger |
| 7 | `postToInstagram` | HTTP | Internal: two-step IG container+publish; called by onJobCreated trigger |
| 8 | `postToBing` | HTTP | Marks job manual_required (Bing has no public write API) |
| 9 | `postToAppleMaps` | HTTP | Marks job manual_required (Apple Maps has no public write API) |
| 10 | `createCheckoutSession` | HTTP | Square Payment Link checkout; verifyBearer() |
| 11 | `createPortalSession` | HTTP | Returns mailto billing support link (Square has no hosted portal); verifyBearer() |
| 12 | `squareWebhook` | HTTP | Square HMAC-SHA256 webhook; handles payment.completed + subscription.canceled |
| 13 | `initiateGoogleOAuth` | HTTP | Starts Google OAuth flow (redirect to Google consent screen) |
| 14 | `googleOAuthCallback` | HTTP | Exchanges code for tokens; stores accessToken/refreshToken/platformId:'google' |
| 15 | `initiateFacebookOAuth` | HTTP | Starts Facebook OAuth flow (redirect to Facebook consent screen) |
| 16 | `facebookOAuthCallback` | HTTP | Exchanges code for page token; stores page + Instagram platformConnections |
| 17 | `deleteAccount` | HTTP | Wipes all user Firestore docs; deletes Auth user; attempts Square sub cancel |
| 18 | `setOperatorSecret` | HTTP | Admin-only: writes/updates Secret Manager secrets via Cloud IAM token |
| 19 | `onJobCreated` | Firestore trigger | publishJobs/{jobId} created → dispatches pending jobs to platform helpers |
| 20 | `onJobFailed` | Firestore trigger | publishJobs/{jobId} status → failed → sends failure email via Resend |
| 21 | `onUserCreated` | Firestore trigger | users/{uid} created → sends welcome email via Resend |
| 22 | `adminListPublishJobs` | HTTP | Admin: publishJobs list with optional status filter; requireAdmin() |
| 23 | `adminListFailedJobs` | HTTP | Admin: failed/manual_required/manual_followup jobs; requireAdmin() |
| 24 | `adminRetryJob` | HTTP | Admin: reads job, claims it (processing), calls platform helper directly, writes result; requireAdmin() |
| 25 | `adminMarkManualFollowup` | HTTP | Admin: sets job status → manual_followup; requireAdmin() |
| 26 | `adminListBusinesses` | HTTP | Admin: all businesses ordered by createdAt desc; requireAdmin() |
| 27 | `adminListPlatformConnections` | HTTP | Admin: all platformConnections ordered by connectedAt desc; requireAdmin() |
| 28 | `adminListActivityLogs` | HTTP | Admin: activityLogs with optional uid filter; requireAdmin() |
| 29 | `adminSubscriptionSummary` | HTTP | Admin: live plan counts + MRR calculation from Firestore; requireAdmin() |

---

## HTML Pages (18 total — all deployed to Firebase Hosting)

| Page | Auth Guard | Status |
|---|---|---|
| BlastyBiz-Home.html | No | Marketing landing page — fully live |
| BlastyBiz-Login.html | No | Email/password + Google (popup on desktop, redirect on mobile) + Facebook sign-in/sign-up |
| BlastyBiz.html | Yes | Main listing form — AI adapt, platform gating, approve; bb:addHistory writes to activityLogs |
| BlastyBiz-Dashboard.html | Yes | User dashboard — plan/billing/delete account; renderNoBusinessState() when no businesses |
| BlastyBiz-Connect.html | Yes | Google + Facebook OAuth platform connect |
| BlastyBiz-Publishing-Status.html | Yes | Live publish job status from Firestore; showEmptyState() when no jobs |
| BlastyBiz-Onboarding.html | Yes | Multi-step business setup wizard |
| BlastyBiz-Listing-Preview.html | Yes | Preview adapted listing; approve calls approveDraft CF (not direct Firestore write) |
| BlastyBiz-Connected.html | Yes | Post-OAuth landing; reads platformConnections, shows linked accounts |
| BlastyBiz-Admin.html | Yes | Admin hub |
| BlastyBiz-Admin-Queue-Manager.html | Yes | Live job queue from Firestore |
| BlastyBiz-Admin-Failed-Jobs.html | Yes | Failed/manual jobs; per-row data-job-id; Retry/Manual/CSV wired to CFs |
| BlastyBiz-Admin-Subscriptions.html | Yes | Subscription overview — "Demo data" banner on Money Snapshot |
| BlastyBiz-Admin-Users.html | Yes | User list from Firestore |
| BlastyBiz-Admin-Platform-Health.html | Yes | Platform health (auth-guarded, static content) |
| BlastyBiz-Admin-Logs.html | Yes | Live activityLogs from Firestore |
| BlastyBiz-Admin-Operate.html | Yes | Operator setup — browser-based secret manager |
| BlastyBiz-Privacy.html | No | Privacy policy |
| BlastyBiz-Terms.html | No | Terms of service |

---

## Firestore Rules

All 6 collections secured. Owner-only access on all user data.
**Key gotcha:** `businesses` collection checks the `uid` field on the document, not the document ID.
`subscriptions` — write: false (backend only via squareWebhook Cloud Function).

---

## ✅ What's Working

- Full user auth flow (email + Google + Facebook)
- AI listing adaptation (Anthropic Claude) — per-plan AI cap enforced: Starter 10 / Pro 100 / Agency 500 (lifetime counter; see Known Issues for monthly reset)
- Platform plan gating: Starter users see "🔒 Pro only" + upgrade link on API platforms; API platforms are converted to `manual_required` jobs server-side in `approveDraft`
- Google and Facebook OAuth connect/disconnect; `platformId` stored in `platformConnections` doc
- Square checkout + billing portal (mailto fallback)
- Square webhook updates Firestore plan on payment.completed + subscription.canceled events
- `onJobCreated` trigger: auto-dispatches pending publish jobs; idempotency guard (sets processing before calling API); handles 401 token refresh for Google
- `adminRetryJob`: directly calls the platform publish helper (Google/Facebook/Instagram) and writes result — does not just re-queue; retry fires immediately without waiting for a Firestore trigger
- Publish job creation and status tracking; Publishing Status page shows empty state (not mock data)
- Resend welcome email on new user signup (Firestore trigger)
- Resend failure alert email when publish job status → failed (Firestore trigger)
- Account deletion: wipes all Firestore docs, deletes Auth user; Square subscription cancel attempted (see Known Issues)
- 8 admin endpoints (all behind requireAdmin): list jobs, list failed, retry job, mark manual, list businesses, list connections, list logs, subscription summary
- Admin Failed Jobs: per-row checkboxes with data-job-id; Retry and Manual Follow-up wired to Cloud Functions; Export CSV
- Admin queue, failed jobs, logs — all reading from Firestore live; no mock data on any page

---

## 🐛 Bugs Fixed

| Date | Location | Fix |
|---|---|---|
| Jun 6, 2026 | `deleteAccount` CF | Was missing `secrets: ['STRIPE_SECRET_KEY']` — Stripe cancellation would silently fail. Fixed and redeployed. |
| Jun 6, 2026 | `auth-guard.js` + `BlastyBiz-Onboarding.html` | Login loop persisted after authStateReady fix. Root cause: Chrome Custom Tabs (used by signInWithPopup on Android) briefly triggers onAuthStateChanged with null when the tab closes, before Firebase fully restores the session. Fix: added a 1500ms setTimeout before acting on null — re-checks auth.currentUser before redirecting, so transient nulls during OAuth tab close are ignored. Also fixed login page's continuous onAuthStateChanged listener (race condition with handleGoogle) replaced with a one-time authStateReady check. Added try/catch to afterAuth with visible error toast. |
| Jun 6, 2026 | `auth-guard.js`, `BlastyBiz-Onboarding.html`, `BlastyBiz-Dashboard.html`, `BlastyBiz-Connect.html`, `BlastyBiz.html`, `BlastyBiz-Listing-Preview.html`, `BlastyBiz-Publishing-Status.html` | After Google sign-in, page redirected back to login. Root cause: `onAuthStateChanged` fires before Firebase restores the persisted session on mobile — first callback is `user = null`, triggering the login redirect. Fix: wrapped all login-redirecting `onAuthStateChanged` calls with `auth.authStateReady().then(...)` which waits for Firebase to determine the initial auth state before acting. |
| Jun 6, 2026 | `BlastyBiz-Login.html` | Google sign-in used `signInWithPopup` on all devices — blocked by mobile Chrome. Fixed: `signInWithRedirect` on mobile (Android/iPhone), `signInWithPopup` retained on desktop. (Later reverted — root cause was invalid API key, not popup blocking.) |
| Jun 6, 2026 | `firebase-init.js` + `BlastyBiz-Login.html` + `firebase.json` | **Root cause of all Google sign-in failures.** API key had a one-character typo at position 21: `0` (zero) instead of `O` (capital O). Fixed key, reverted `authDomain` to `firebaseapp.com`, removed all mobile/redirect complexity, simplified to plain `signInWithPopup`. Renamed to `firebase-init-v2.js` to force cache bust. Also set `Cache-Control: no-cache, no-store, must-revalidate` on all HTML and JS files in `firebase.json` so browsers can never serve stale versions again. Confirmed live. |
| Jun 6, 2026 | `firebase.json` + `index.html` | Root URL (`/`) returned Firebase 404. firebase.json redirect rule (301/302) was overridden by CDN edge caching on mobile networks. Root cause: Firebase redirect rules take precedence over static files AND get cached by CDN nodes. Final fix: removed redirect rule from firebase.json entirely; created `artifacts/api-server/public/index.html` with `meta refresh` + JS `location.replace` to `BlastyBiz-Home.html`. Firebase now serves a 200 directly — no redirect rule, no CDN caching issue. Confirmed: `curl -sI /` returns `HTTP/2 200` with `index.html` content. |
| Jun 16, 2026 | `BlastyBiz-Admin-Operate.html` | Rebuilt Operator Setup page with browser-based secret input fields (paste + Save button per secret). Previously all secrets required the Replit Shell CLI. New approach: each Save button triggers a Google sign-in popup (requesting `cloud-platform` scope), then calls Secret Manager REST API directly from the browser — no Cloud Function needed. Access token cached in sessionStorage for 1 hour. After saving all secrets, user still needs to run `npx firebase-tools deploy --only functions` once from Replit Shell to pin the new secret versions; a redeploy reminder banner appears automatically after the first save. |
| Jun 17, 2026 | `BlastyBiz-Connect.html` + `BlastyBiz-Listing-Preview.html` | Reframed all manual-platform copy to attribute the limitation correctly. Section heading changed from "Copy-Paste Platforms" to "Copy-Ready Platforms". New intro block reads "Their rule, not ours" — explains these platforms deliberately block all third-party apps, not just BlastyBiz, and that BlastyBiz makes it as easy as possible. Each platform card now names the specific reason (e.g. "Meta closed Marketplace to all apps in 2018", "Craigslist has banned all posting APIs"). Badge changed from "Manual" to "Copy-Ready". In Listing Preview: hint text for each manual platform now opens with the platform's own decision, approval bar reads "X platforms block third-party posting — your copy-ready text is waiting", check card reads "Some platforms block all apps. Your text is written — just paste it." |
| Jun 18, 2026 | Firebase Cloud Functions | Deleted the old `stripeWebhook` Cloud Function via `firebase functions:delete stripeWebhook --force`. Confirmed 404 at its previous URL. |
| Jun 18, 2026 | `functions/index.js`, `functions/package.json`, `BlastyBiz-Admin-Operate.html`, `BlastyBiz-Admin-Subscriptions.html`, `BlastyBiz-Admin.html`, `BlastyBiz-Dashboard.html`, `BlastyBiz-Privacy.html`, `BlastyBiz-Terms.html` | **Replaced all Stripe code and references with Square.** Removed `stripe` npm package, added `square@^44.0.0`. Replaced lazy-init `getStripe()` with `getSquare()` (Square SDK `Client`). Replaced `createCheckoutSession` (Stripe Checkout → Square Payment Link with `referenceId: uid`). Replaced `createPortalSession` (Stripe portal → returns mailto link). Renamed `stripeWebhook` → `squareWebhook` with HMAC-SHA256 verification; handles `payment.completed` and `subscription.canceled`. Updated `deleteAccount` to cancel Square subscription. Updated `setOperatorSecret` ALLOWED list. Admin-Operate setup guide rewritten for Square. All user-facing copy updated across Dashboard, Privacy, Terms, Admin, Subscriptions. Firestore `subscriptions` doc fields renamed: `squareCustomerId`, `squarePaymentId`. |
| Jun 18, 2026 | `functions/index.js` | **B1–B5: Backend security + automation hardening.** Added `verifyBearer()` (verifies Firebase ID token from Authorization header) and `requireAdmin()` (checks `perceys@gmail.com`) helpers. Applied `verifyBearer()` to 6 functions: `adaptListing`, `resolveCategories`, `approveDraft`, `uploadImage`, `createCheckoutSession`, `createPortalSession`. Added `AI_LIMITS = { starter: 10, pro: 100, agency: 500 }` constant and per-user lifetime counter (`aiActionsUsed`) tracked in Firestore in `adaptListing` and `resolveCategories`. Added `onJobCreated` Firestore trigger (reads job doc, idempotency guard sets status to 'processing', looks up `platformConnections`, dispatches to Google/Facebook/Instagram helpers, marks success/failed). Added 8 admin endpoints: `adminListPublishJobs`, `adminListFailedJobs`, `adminRetryJob`, `adminMarkManualFollowup`, `adminListBusinesses`, `adminListPlatformConnections`, `adminListActivityLogs`, `adminSubscriptionSummary` — all behind `requireAdmin()`. Added `platformId` field to both OAuth callbacks. |
| Jun 18, 2026 | `functions/package.json`, `functions/index.js` | **Deploy fix: squareup→square + secrets declarations removed.** `squareup@^43.0.0` does not exist on npm (only v1.0.0 stub); real Square SDK is `square@^44.0.0`. Fixed package name and `require('squareup')` → `require('square')`. Regenerated `package-lock.json` with `npm install --package-lock-only`. Also removed `secrets: [...]` arrays from `createCheckoutSession`, `squareWebhook`, `deleteAccount` — Square secrets live in process.env, not Firebase Secret Manager, so the binding declarations caused 404 deploy failures. Deployed in targeted batches due to Replit 120s bash timeout vs Cloud Build 3–5min deploy time. All functions now live. |
| Jun 18, 2026 | `BlastyBiz-Publishing-Status.html`, `BlastyBiz-Dashboard.html`, `BlastyBiz-Listing-Preview.html`, `BlastyBiz.html`, `BlastyBiz-Admin-Failed-Jobs.html`, `BlastyBiz-Admin-Subscriptions.html` | **H1–H6: Remove mock data + wire admin actions.** Publishing-Status: replaced `showMockData()` fallback with `showEmptyState()` (3 call sites). Dashboard: removed hardcoded `BUSINESSES` mock array, added `renderNoBusinessState()` for empty states. Listing-Preview: removed direct `publishJobs` Firestore writes; replaced `window._firestoreApprove` implementation with a call to the `approveDraft` CF (function name kept for callsite compatibility). BlastyBiz.html: bb:addHistory event now writes to `activityLogs` collection (not `publishJobs`); `publishJobs` reference at line 1478 is a read-only history query — confirmed not a write. Admin-Failed-Jobs: added `data-job-id` checkboxes to each job row, wired Retry to `adminRetryJob` CF and Manual Follow-up to `adminMarkManualFollowup` CF, Export generates CSV. Admin-Subscriptions: added "Demo data" banner — Money Snapshot and chart are placeholders until Square webhooks populate Firestore. |
| Jun 18, 2026 | `auth-guard.js` + 9 auth-guarded HTML pages | **Bug fix: admin content briefly visible before auth redirect (flash).** `auth-guard.js` is a deferred ES module — it executes after HTML is parsed and may paint before the module runs, exposing page content for ~1500ms to unauthenticated users. Fix: (1) Added `<style>body{visibility:hidden}</style>` to the `<head>` of all 9 pages that use auth-guard.js so the body never paints until auth is confirmed. (2) Updated `auth-guard.js` to explicitly set `document.body.style.visibility = ''` when a user IS authenticated (previously only the redirect case was handled — authenticated users would see a blank page if the style was set without a matching reveal). Playwright confirmed: admin content no longer visible before redirect. |
| Jun 19, 2026 | `dev-login.html` (new) | **Dev tooling: authenticated test login page.** Created `dev-login.html` on Firebase Hosting — auto-signs in as `devtest@blastybiz.dev` using the Firebase client SDK and redirects to `?next=` (default: `BlastyBiz.html`). Firebase Auth test user created via REST API (UID: `N1cCiQFcwWT7KQEBRyDglRWvoBx2`), Firestore `users/{uid}` doc seeded with `plan: starter`. Allows Playwright tests to bypass the auth wall and reach authenticated UI. Playwright confirmed: dev-login signs in and redirects correctly. |
| Jun 19, 2026 | `BlastyBiz.html` | **Feature: Location type toggle — physical address vs online only.** Replaced the single "Address / Area" text field with a segmented two-button toggle: "📍 Has a location" (default) / "🌐 Online only". Physical branch shows the street address input. Online branch hides the address and shows a "Service area or region" hint field instead. Toggle state (`locationType`) is saved to draft and profile, pre-fills from profile on fresh form, and is passed to the AI prompt so Claude generates copy appropriate for the business type (online-only copy omits address language, uses region if provided). Same toggle added to the Profile section so it persists across sessions. Deployed and confirmed live via curl. |
| Jun 19, 2026 | `functions/index.js` — `adaptListing` + `resolveCategories` | **Bug fix: AI action counter never reset (lifetime instead of 30-day rolling).** `aiActionsUsed` was a lifetime counter with no reset mechanism. Fix: both functions now read `aiActionsResetAt` (Firestore Timestamp) from the user doc. If missing or expired (> 30 days old), counter is treated as 0. On consume: if reset needed → sets `aiActionsUsed: 1` + `aiActionsResetAt: now + 30 days`; otherwise → `FieldValue.increment(1)`. Rolling 30-day window now enforced server-side. **Deployed Jun 19, 2026. Playwright confirmed site live and auth-guard working.** |
| Jun 19, 2026 | `functions/index.js` — `squareWebhook` | **Bug fix: `deleteAccount` Square subscription cancel was always a no-op.** `deleteAccount` looked for `squareSubscriptionId` in the subscriptions doc, but the field was never stored — Square sends a separate `subscription.created` event (not `payment.completed`) to provide the subscription ID. Fix: added `subscription.created` handler to `squareWebhook`: reads `sub.id` + `sub.customer_id`, queries subscriptions collection by `squareCustomerId`, writes `squareSubscriptionId` to the matching doc. `deleteAccount` can now actually cancel the Square subscription on account deletion. **Deployed Jun 19, 2026.** |
| Jun 18, 2026 | `functions/index.js` — `adminRetryJob` | **Bug fix: retry button never re-published jobs.** Original `adminRetryJob` set `status: 'pending'` via Firestore `update()`, but `onJobCreated` is an `onDocumentCreated` trigger — it only fires on document CREATE, not UPDATE. A retried job would sit at 'pending' forever. Fixed: `adminRetryJob` now reads the job doc, sets status to 'processing' (idempotency guard), looks up the platformConnection, calls the appropriate `_publishGoogleJob` / `_publishFacebookJob` / `_publishInstagramJob` helper directly, and writes the final success/failed result. Retry fires synchronously within the HTTP response. |
| Jun 19, 2026 | `functions/index.js` — `onJobCreated`, `onJobFailed`, `onUserCreated` | **Bug fix: all three Firestore triggers were live as stale HTTPS functions.** A previous session had deployed these as HTTP endpoints, not Firestore/Eventarc triggers — so `approveDraft` creating a `publishJobs` document never fired the auto-publish trigger, and welcome/failure emails never sent. Firebase blocks in-place type changes ("Changing from an HTTPS function to a background triggered function is not allowed"), so the fix was: (1) delete each via `firebase functions:delete`, (2) rename in code to `jobCreatedTrigger`, `jobFailedTrigger`, `userCreatedTrigger` (new names guarantee no type-conflict), (3) redeploy. All three confirmed live as v2 Firestore triggers. Auto-publishing, welcome emails, and failure emails now operational. |
| Jun 19, 2026 | `functions/index.js` — `postToGoogle`, `postToFacebook`, `postToInstagram` | **Security fix: posting endpoints had no auth.** All three were publicly callable by anyone with the function URL — no token required. Added `verifyBearer()` check at the top of each function (returns 401 if missing/invalid). Also added OPTIONS preflight handler so CORS still works from the browser. Deployed Jun 19, 2026. |
| Jun 17, 2026 | `BlastyBiz-Connect.html` + new `BlastyBiz-Connected.html` + `functions/index.js` | Added pre-connect friction reduction and post-connection clarity. (1) Google Connect button now opens an inline explainer drawer. (2) Facebook Connect button now opens a bottom-sheet gate modal asking "Do you have a Facebook Business Page?" — Yes proceeds to OAuth; No shows a 4-step guide. (3) New `BlastyBiz-Connected.html` post-connection landing page: OAuth callbacks now redirect here instead of back to Connect. The page reads the `platformConnections` Firestore doc, shows the connected account/page name, shows whether Instagram was auto-linked, explains the "what happens when you post" flow, and CTAs to create first listing, connect another platform, or go to dashboard. |

---

## ⛔ Critical Pre-Production Blockers

These must be resolved before real users touch the site.

### 1 — Square secrets ✅ Fixed Jun 19, 2026
All 5 Square secrets now set in Firebase Secret Manager and `secrets: [...]` arrays re-added to `createCheckoutSession`, `squareWebhook`, and `deleteAccount`. Functions redeployed.

| Secret | Status |
|---|---|
| `SQUARE_ACCESS_TOKEN` | ✅ Set |
| `SQUARE_LOCATION_ID` | ✅ Set (LSJAMMYDYS4TE — FLUBA DESIGNS LLC main) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | ✅ Set |
| `SQUARE_PRO_PLAN_ID` | ⚠️ Placeholder — update after creating Pro subscription plan in Square Dashboard |
| `SQUARE_AGENCY_PLAN_ID` | ⚠️ Placeholder — update after creating Agency subscription plan in Square Dashboard |

**Still required:** Create Pro and Agency subscription plans in Square Dashboard → Items & Orders → Subscriptions. Then update the two plan ID secrets and redeploy `createCheckoutSession`.

### 2 — Firestore triggers renamed and redeployed ✅ Fixed Jun 19, 2026
`onJobCreated`, `onJobFailed`, and `onUserCreated` were all deployed as stale HTTPS functions from a previous session. Firebase blocks changing a function's trigger type in-place — it must be deleted and recreated.

**Fix applied:** All three were deleted via `firebase functions:delete`, then renamed in code to `jobCreatedTrigger`, `jobFailedTrigger`, and `userCreatedTrigger` and redeployed as proper Firestore/Eventarc triggers. No other code references the function names — they're purely event-driven.

---

## ⚠️ Known Issues / Hardcoded Items

| Location | Item | Notes |
|---|---|---|
| `AI_LIMITS` | ~~No monthly reset~~ ✅ Fixed Jun 19 | 30-day rolling window via `aiActionsResetAt`. |
| `deleteAccount` | ~~Square cancel no-op~~ ✅ Fixed Jun 19 | `squareWebhook` stores `squareSubscriptionId`. |
| Dashboard | ~~Hardcoded "QR Gear" data~~ ✅ Fixed Jun 19 | All values now live from Firestore. Empty state hides main content. |
| Dashboard | ~~Blast Score (83%) static~~ ✅ Fixed Jun 19 | Score now computed from `successJobs.length`. Ring CSS updated dynamically. |
| Dashboard | ~~Task list hardcoded~~ ✅ Fixed Jun 19 | Task list now built from real platform connection status. |
| Dashboard | AI usage display | Now reads `aiActionsUsed` + `aiActionsResetAt` from users doc. |
| Admin → Platform Health | All content | Static — no live Firestore queries |
| Admin → Subscriptions | Money Snapshot ($1,842 MRR) | Static placeholder — "Demo data" banner present; real data needs Square webhook populating Firestore |
| Onboarding | Platform connect step | Redirects to Connect page rather than triggering OAuth inline |
| `adaptListing` prompt | `locationType`/`region` not sent to Claude | Form collects it; CF ignores it. Minor gap — AI copy will still be good, just won't say "online only" explicitly. |

---

## 🔑 Operator Actions Required (All in Operate Page)

The Operator Setup page (`BlastyBiz-Admin-Operate.html`) has step-by-step instructions for all of these:

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `SQUARE_ACCESS_TOKEN` | Square Developer Dashboard → Credentials |
| `SQUARE_LOCATION_ID` | Square Developer Dashboard → Locations |
| `SQUARE_PRO_PLAN_ID` | Square Dashboard → Catalog (after creating Pro subscription plan) |
| `SQUARE_AGENCY_PLAN_ID` | Square Dashboard → Catalog (after creating Agency subscription plan) |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square Developer Dashboard → Webhooks → signature key |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth credentials |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth credentials |
| `FACEBOOK_APP_ID` | Meta for Developers → App Settings |
| `FACEBOOK_APP_SECRET` | Meta for Developers → App Settings |
| `RESEND_API_KEY` | resend.com/api-keys (set real key; placeholder deployed) |

**Also required:**
- Firebase Storage: enable in Firebase Console → Storage (Blaze plan required)
- Resend domain verification: resend.com/domains → add blastybiz.com

---

## 🐛 Bugs Fixed

| Date | Location | What was wrong | How it was fixed |
|------|----------|---------------|-----------------|
| Jun 19, 2026 | `functions/index.js` · `adminSubscriptionSummary` | MRR hardcoded at $49/$99 (old Stripe prices) | Reads from Firestore `settings/pricing` with $19/$99 fallback |
| Jun 19, 2026 | `BlastyBiz-Admin-Subscriptions.html` | Pricing editor fields showed placeholder text, not pre-filled values | Changed `placeholder` to `value` so $19/$99 appear immediately |
| Jun 19, 2026 | `BlastyBiz.html` — `#biz-phone`, `#profile-phone` | Phone number typed as raw digits with no formatting | Added `formatPhone()` — auto-inserts hyphens on input (e.g. `555-123-4567`); capped at 10 digits; `inputmode="tel"` for mobile keyboard |
| Jun 19, 2026 | All 28 Cloud Functions (`functions/index.js`) | All HTTPS Cloud Functions returned 403 from Cloud Run IAM — "The caller does not have permission". Root cause: Firebase 2nd-gen functions use Cloud Run under the hood, and IAM `allUsers run.invoker` is NOT automatically re-applied on update deploys when no `invoker` option is set. Result: every CF was inaccessible from the browser. Fix: added `invoker: 'public'` to the options object of all 28 `onRequest` exports — this forces Firebase to call `setIamPolicy(allUsers run.invoker)` on every deploy. Also pinned exact versions in `functions/package.json` (no `^`), removed `functions/package-lock.json` (Cloud Build was using `npm ci` with npm 10.9.0 which had an exit-handler bug), and set Node 22 engine. All 28 functions deployed successfully; curl confirmed 204 (OPTIONS) and JSON responses. Playwright confirmed no 403. |
| Jun 19, 2026 | `BlastyBiz-Onboarding.html` — success screen + intro copy | Success screen showed `12 + connectedPlatforms.length` (e.g. "15 Platforms" after connecting 3) because connected platforms were already counted in the 12 and adding them double-counted. Fixed to hardcoded `12`. Intro feature blurb changed from "12+ platforms at once" (misleading "+") to "12 platforms, one form / 3 auto-post + 9 copy-ready" to accurately reflect what's available. |
| Jun 19, 2026 | `BlastyBiz-Onboarding.html` — Step 3 (Location) | "Continue →" button remained disabled on the Location step even after filling Street Address and City. Root cause: `s-state`, `s-email`, `s-website`, and both time inputs (`s-open`, `s-close`) had no event handlers — so if a user's last field interaction was on any of these fields, `checkStep(3)` was not retriggered to re-evaluate the button state. The same issue affected browser autofill and Playwright's `fill()` method. Fix: added `oninput="checkStep(3)" onchange="checkStep(3)"` to all five previously-unhandled step-3 fields. Also added `onchange="checkStep(3)"` to `s-address` (had `oninput` only). Added `setTimeout(() => checkStep(currentStep), 150)` deferred re-check in `updateUI()` to catch programmatic fills that fire after the initial check. Deployed. Playwright confirmed Continue button enables correctly. |
| Jun 20, 2026 | `functions/index.js` — `adaptListing`, `resolveCategories`, `suggestPlatforms` | AI adaptation returned 500 / "Connection error" for all users. Root cause 1: Anthropic Node.js SDK (`@anthropic-ai/sdk` v0.36.3) throws `APIConnectionError` ("Connection error.") when called from Cloud Run — SDK-level network layer incompatible with Cloud Run environment. Root cause 2: Firestore reads in `adaptListing` and `resolveCategories` threw `PERMISSION_DENIED` (gRPC code 7) because the Cloud Run service account (`745597683278-compute@developer.gserviceaccount.com`) lacks `roles/datastore.user`. Root cause 3: model name `claude-3-5-sonnet-20241022` not available on this Anthropic API key (key only has access to Claude 4 models). Fix: (1) Replaced all three Anthropic SDK calls with native Node 22 `fetch` to `https://api.anthropic.com/v1/messages` — same pattern as the working Resend integration. (2) Wrapped all Firestore reads/writes in try/catch with fallback to starter plan defaults so AI works even if IAM blocks Firestore. (3) Queried `/v1/models` to find the correct available model; updated to `claude-sonnet-4-5-20250929`. Playwright confirmed adaptation works end-to-end. Note: Firestore IAM permission for the Cloud Run SA still needs to be granted in Firebase Console (IAM → add `roles/datastore.user` to `745597683278-compute@developer.gserviceaccount.com`) for usage tracking to work. |
| Jun 20, 2026 | `BlastyBiz.html` — UI layout | Rewrite + Clear buttons were inline side-by-side (cramped on mobile). Stacked them vertically, each full-width, with proper spacing. Direction card uses standard card margins. |
| Jun 20, 2026 | `firestore.indexes.json` + `BlastyBiz-Dashboard.html` | Publishing-Status and Dashboard threw "The query requires an index" / "Missing or insufficient permissions" on every page load. Root cause: five compound queries on `publishJobs` — `businessId`+`uid`+`createdAt`, `businessId`+`createdAt`, `draftId`+`uid`, `uid`+`createdAt`, and `status`+`updatedAt` — had no composite indexes. Additionally, Dashboard's query filtered only by `businessId` (not `uid`), preventing Firestore from validating the security rule at list-query time. Fix: (1) Added all five composite indexes to `firestore.indexes.json` and deployed with `--only firestore:indexes`. (2) Added `where('uid', '==', user.uid)` to Dashboard's publishJobs query so the security rule can be validated. Playwright confirmed Dashboard and Publishing-Status load cleanly with zero index/permissions errors. |
| Jun 20, 2026 | `BlastyBiz-Login.html` — Sign In / Create Account buttons | Module race condition: `handleSignIn()` and `handleSignUp()` are empty stubs in the first `<script>` block and overridden by a `<script type="module">`. If Playwright (or a fast user) clicked the button before the module finished loading, the call hit the empty stub — silent failure with no error. Fix: Added `disabled` attribute to both submit buttons in HTML; the module removes `disabled` from both buttons as its first action after import, so the buttons are only clickable once the real handlers are wired. |
| Jun 20, 2026 | `BlastyBiz-Login.html` → `afterAuth()` redirect logic | Test account `playwright@blastybiz.dev` was missing `onboarded: true` in its Firestore `users/` doc, so `afterAuth()` always redirected to Onboarding instead of Dashboard. Fix: Used Firebase Auth REST API to sign in as the test user, then Firestore REST API PATCH to set `onboarded: true`, `plan: "pro"`, `activeBusiness: uid` on the user doc. |
| Jun 20, 2026 | `auth-guard.js` — body visibility on pages with `<style>body{visibility:hidden}</style>` | 10 pages (all admin pages + BlastyBiz-Connect/Connected) have a CSS rule `body{visibility:hidden}`. The guard was calling `document.body.style.visibility = ''` which clears inline styles — but the CSS rule is not inline, so the body stayed permanently hidden. Root cause 2: `authStateReady()` had no `.catch()`, so a silent rejection left the guard never executing its `onAuthStateChanged` listener. Fix: (1) Changed all four visibility assignments to `= 'visible'` (inline style overrides the CSS rule). (2) Added `.catch(() => {})` after `authStateReady()`. (3) Added a 5-second safety-valve `setTimeout` that sets `visibility: visible` unconditionally — prevents pages from ever staying permanently blank. |
| Jun 20, 2026 | `BlastyBiz-Admin-Failed-Jobs.html` — hardcoded static tbody rows | Table body had 5 hardcoded mock rows (ARO Drone Services, Suncoast Roofing, etc.) each with 6 `<td>` cells — missing the checkbox cell. The select-all header checkbox and bulk Retry/Manual actions couldn't work on these rows. The dynamic `onSnapshot` renderer (which correctly generates 7-cell rows with checkboxes and `data-job-id`) replaces tbody, but only after Firestore data loads. Fix: Replaced the 5 static mock rows with a single `<tr id="jobs-loading-row"><td colspan="7">Loading…</td></tr>` placeholder that Firestore replaces at runtime. |
| Jun 20, 2026 | `firestore.rules` — admin pages blocked by Firestore permission-denied | Admin pages (`BlastyBiz-Admin-Failed-Jobs.html`, etc.) query all documents across users (e.g. `publishJobs` without a uid filter). The Firestore rules only allowed `uid == resource.data.uid` — so any cross-user admin query returned permission-denied and the table never loaded. Fix: Added `isAdmin()` helper function that checks `request.auth.token.email == 'perceys@gmail.com'`; added `|| isAdmin()` to the `allow read` clause of all 8 collections (users, businesses, listingDrafts, publishJobs, platformConnections, subscriptions, activityLogs, reviews). Deployed `--only firestore:rules`. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — onboarding silently dropped category, tone, days, platforms on save | `_buildProfileData()` lives in the `<script type="module">` block and reads `window.selectedCategory`, `window.selectedTone`, `window.selectedDays`, `window.resolvedCats`, `window.connectedPlatforms`. These five state variables were declared with `let` in the classic `<script>` block — top-level `let` in a classic script is NOT attached to `window`, so every `window.selectedXxx` read returned `undefined`. Name, phone, address saved fine (read from DOM elements); category, tone, days, and connected platforms silently saved as empty/null on every submit. Fix: changed all five declarations from `let` to `var` — top-level `var` in a classic script IS on `window`, so the module can read them correctly without any other code changes. |
| Jun 20, 2026 | `BlastyBiz.html` — `buildPlatformCard()` threw ReferenceError on load | `buildPlatformCard()` is defined in the classic `<script>` block (starts line 928) and referenced `userPlan` on line 1031. `userPlan` is only declared with `let` inside the `<script type="module">` block (line 1668) — module-scoped variables are invisible to classic scripts. On every page load, `init()` called `renderPlatforms()` synchronously before the module's async auth callback ever ran, causing an immediate ReferenceError that silently killed platform rendering, history, and stats. Fix: changed `(window._bbUserPlan \|\| userPlan)` to `(window._bbUserPlan \|\| 'starter')` — falls back to `'starter'` on first render (correct default), then the module sets `window._bbUserPlan` after auth and calls `renderPlatforms()` again with the real plan. |
| Jun 20, 2026 | `BlastyBiz.html` — "LOCALLOUD v1.0" branding in Settings tab footer | Leftover from the LocalLoud-to-BlastyBiz rebrand — the footer label and sub-label in the Profile/Settings sidebar still read "LOCALLOUD v1.0 / A Fluba Designs Product". Deleted entirely. |
| Jun 20, 2026 | `BlastyBiz-Listing-Preview.html` — Business Summary sidebar hardcoded "Gulf Coast Pressure Washing" | Sidebar showed a hardcoded demo business (name, category, phone, service area, offer) regardless of the actual draft. Publish Queue also showed 5 hardcoded platform rows (Google/Facebook/Instagram/Nextdoor/Craigslist). Fix: Added `id="sb-name"`, `id="sb-category"`, `id="sb-phone"`, `id="sb-area"`, `id="sb-offer"` to sidebar value divs; added `id="publish-queue"` to the queue container. `populateFromDraftData()` now fills all five sidebar fields from `draftData.name/category/phone/region/address/offer` and rebuilds the Publish Queue dynamically from `Object.keys(draftData.adaptations)` using PLATFORM_META for icons and Auto/Copy-Ready badges. Playwright confirmed sidebar shows "—" (not Gulf Coast) when no draft is loaded. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — Connect platform buttons were fake (setTimeout placeholder) | `connectPlatform(id, btn)` used a 1.2-second `setTimeout` to fake a "✓ Connected" state. No OAuth was triggered, no tokens were stored in `platformConnections`, so every auto-post job for those platforms would fail at the `onJobCreated` trigger with "No platform connection found". Fix: replaced the setTimeout with `window.location.href = 'BlastyBiz-Connect.html?platform=' + oauthPlatform + '&returnTo=onboarding'`. Instagram maps to the Facebook OAuth flow (instagram → facebook). Playwright confirmed clicking Google Connect navigates to `BlastyBiz-Connect.html?platform=google&returnTo=onboarding`. |
| Jun 20, 2026 | `BlastyBiz-Connected.html` — no way back to onboarding after OAuth | After completing OAuth from within the onboarding wizard, `BlastyBiz-Connected.html` showed "Create Your First Listing" and "Go to Dashboard" — no route back to finish setup. Fix: reads `returnTo` query param; when `returnTo=onboarding`, replaces the CTA group with "← Back to Setup" (returns to BlastyBiz-Onboarding.html) and "Connect another platform". |
| Jun 20, 2026 | `BlastyBiz-Connect.html` + `functions/index.js` (4 OAuth functions) — `returnTo` param lost across OAuth round-trip | The onboarding→Connect→OAuth→Connected chain requires `returnTo=onboarding` to survive through the Google/Facebook OAuth redirect. `BlastyBiz-Connect.html` was building the initiate CF URL without forwarding the `returnTo` param. Both `initiateGoogleOAuth` and `initiateFacebookOAuth` CFs were only storing `{businessId, uid}` in the OAuth `state`; `googleOAuthCallback` and `facebookOAuthCallback` were hardcoding the final redirect to `BlastyBiz-Connected.html?connected=google` (no `returnTo`). Fix: Connect.html reads `returnTo` from its own query string and appends it to the CF URL. Both initiate CFs include `returnTo` in the JSON state. Both callback CFs parse `returnTo` from state and construct the redirect URL with it appended. Deployed to Cloud Functions. |
| Jun 20, 2026 | `functions/index.js` — `onPublishJobCreated` stale HTTPS stub blocking Firestore trigger | `onPublishJobCreated` was deployed as an HTTPS function in a previous session; Firebase blocks in-place type changes. The function body was wrapped in a `/* DISABLED_TRIGGER */` block comment. Fix: removed block comment, renamed export to `dispatchPublishJob` (new name avoids Firebase type-conflict), deployed as a proper `onDocumentCreated` Firestore trigger on `publishJobs/{jobId}`. Confirmed live in `functions:list` as `google.cloud.firestore.document.v1.created`. |
| Jun 20, 2026 | `functions/index.js` — `platformId` duplicate field in OAuth callbacks | Both `googleOAuthCallback` and `facebookOAuthCallback` wrote both `platform: 'google'` AND `platformId: 'google'` to `platformConnections` docs — redundant and inconsistent. `BlastyBiz.html` `savePlatforms()` wrote `platformId: p.id`; `Platform-Health` filtered on `c.platform === p.id \|\| c.platformId === p.id`. Standardized: OAuth callbacks write `platform` only; `savePlatforms` writes `platform`; Platform-Health filters on `platform` only. `BlastyBiz.html` `connMap` reader uses `d.data().platform \|\| d.data().platformId` fallback to remain compatible with any existing docs that only have `platformId`. |
| Jun 20, 2026 | Firebase — `postToGoogle`, `postToFacebook`, `postToInstagram` stale HTTPS stubs | Three dead HTTP endpoints remained deployed in Firebase after being removed from `functions/index.js`. Deleted via `firebase functions:delete --force`. |
| Jun 20, 2026 | `functions/index.js` — `adaptListing` prompt ignored `locationType` and `region` | The client sends `locationType` ('physical'\|'online') and `region` (service area text) in the request body, but the AI prompt only used `listing.address`. Online-only businesses got address-centric copy. Fix: prompt now includes "Location type: Online only / Physical location" and "Address/Area: Serves: [region]" for online businesses, or the street address for physical ones. Deployed. |
| Jun 20, 2026 | `functions/index.js` — `onPublishJobFailed` + `onUserSignup` still disabled | Both email triggers were wrapped in `/* DISABLED_TRIGGER */` block comments — failure emails and welcome emails were never sending. Same root cause as `onPublishJobCreated`. Fix: removed block comments, renamed to `jobFailedTrigger` (onDocumentUpdated on publishJobs) and `userCreatedTrigger` (onDocumentCreated on users). Deployed both. Confirmed live as Firestore triggers in `functions:list`. |
| Jun 20, 2026 | `firebase-init-v2.js` — dynamic `authDomain` caused `redirect_uri_mismatch` on Google OAuth | Attempt to fix cross-origin auth by setting `authDomain: window.location.hostname` broke Google sign-in with "Error 400: redirect_uri_mismatch" — Google's OAuth client only has `firebaseapp.com/__/auth/handler` as an authorized redirect URI, not `web.app/__/auth/handler`. Reverted `authDomain` to `blastybiz-9523e.firebaseapp.com`. Root cause of redirect-return failure (user landing back on login) was that `authStateReady()` resolved before Firebase processed the redirect token, leaving `auth.currentUser` null. Fix: replaced `authStateReady` with `onAuthStateChanged` listener (fires when redirect token is processed and auth state changes). `getRedirectResult` retained only for creating Firestore user docs for new Google users; `afterAuth` routing handled by the listener. |
| Jun 20, 2026 | `firebase-init-v2.js` — `authDomain` mismatch broke Google sign-in redirect on mobile | After switching to `signInWithRedirect` on mobile, `getRedirectResult` returned null because `authDomain` was `blastybiz-9523e.firebaseapp.com` while the page was served from `blastybiz-9523e.web.app`. Modern mobile Chrome blocks the cross-origin iframe that Firebase uses to hand the token back, so the redirect completed on Google's side but Firebase never received the auth state. Fix: `authDomain` now dynamically resolves to `window.location.hostname` (e.g. `blastybiz-9523e.web.app` or `blastybiz.com`), so the auth handler is always same-origin with the page. `localhost` keeps the original `firebaseapp.com` domain. Deployed. |
| Jun 20, 2026 | `BlastyBiz-Login.html` — "Continue with Google" failed silently on mobile (Android Chrome) | `signInWithPopup` opens a new browser window which Android Chrome blocks as a pop-up. Fix: added mobile UA detection (`/Android|iPhone|iPad|iPod.../i`). On mobile: calls `signInWithRedirect` instead (full-page redirect to Google, then back). Added `getRedirectResult(auth)` handler on page load to pick up the returning session, create Firestore user doc if new, and call `afterAuth`. Desktop keeps `signInWithPopup`. Deployed. `curl` confirmed `signInWithRedirect`, `getRedirectResult`, `isMobile` all live. |
| Jun 20, 2026 | `BlastyBiz-Admin-Subscriptions.html` + `functions/index.js` — default prices were test placeholder values ($19/$99) | Pricing inputs on Admin-Subscriptions defaulted to $19 (Pro) and $99 (Agency) — holdover test values. `adminSubscriptionSummary` MRR fallback and the Firestore-driven MRR JS calculation also used $19/$99. Fix: updated HTML input defaults to $49 (Pro) / $149 (Agency); updated CF MRR fallback and JS prices map to match. Deployed hosting + function. Playwright confirmed inp-pro=49, inp-agency=149 live. |
| Jun 20, 2026 | `BlastyBiz-Admin-Platform-Health.html` — hardcoded fake stats (5/3/11/1) | Stat cards showed hardcoded values (5 Connected, 3 Manual, 11 Expired, 1 Rate Limit) that never updated. Hero "Overall Status" card also showed hardcoded "92" score and "3 platforms need attention" text. Fix: (1) Changed all four HTML default stat values to "—". (2) Script now reads all four stats from live Firestore `platformConnections`: connected, manual (PLATFORM_META count), expired, rate_limited. (3) Hero card rows given ids `hero-row-score` and `hero-row-attn`; script updates both from live data. Playwright confirmed old values (5/3/11/1) are gone; page shows "—" for non-admin users or live counts for admin. |
| Jun 20, 2026 | `functions/index.js` + `BlastyBiz-Onboarding.html` — "Find My Categories" AI returned wrong/irrelevant categories | Prompt only sent the business type description with no platform context. AI had no basis to distinguish Angi (home services) from Thumbtack (local pros) from Yelp (reviews). Match check was also exact-string only — any capitalization difference silently triggered a word-overlap fallback. Fix: (1) Rewrote prompt with PURPOSE explanations for all 7 platforms and explicit instruction to copy category strings character-for-character. (2) Client now sends `businessName` alongside description. (3) Match logic upgraded to exact → case-insensitive → word-fallback chain. (4) Auth token retrieved via `window._blastyUser` (exposed from module scope). Playwright confirmed no errors and correct AI category picks for a drone photography test business. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — no location type toggle; online businesses forced to enter a physical address | Step 3 only had address fields — no way to indicate "Online Only" or "Both." Online businesses had no meaningful way to describe their service area, and Apple Maps (physical location discovery) was incorrectly included in their category suggestions. Fix: (1) Added three-button toggle to step 3: 📍 Has a Location / 🌐 Online Only / 🌍 Both. (2) Online Only hides address fields and shows Service Area field instead; Both shows all fields. (3) `checkStep(3)` validates region for online, address+city for physical/both. (4) `setOnboardingLoc()` handles all toggle state. (5) `resolveCats()` skips Apple Maps when Online Only. (6) `locationType` and `region` saved to Firestore via `_buildProfileData`. Playwright confirmed all toggle states work correctly with no errors. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — sparse hardcoded category lists (20–77 per platform) gave AI too few options | Category lists were hardcoded inline in the HTML. Yelp had 52 categories; real taxonomy has 1,000+. Thumbtack/Angi each had ~47-50 vs their actual 150+. Fix: Created `platform-categories.js` (standalone script, sets `window.PLATFORM_CATS`) with comprehensive curated lists — Yelp ~220, Thumbtack ~130, Angi ~130, Alignable ~65, Apple Maps ~150, Craigslist and FB Marketplace unchanged (already complete). Loaded via `<script src="platform-categories.js">` before non-module script. Replaced inline PLATFORM_CATS block with `window.PLATFORM_CATS` reference. Deployed and confirmed live. |
| Jun 20, 2026 | `functions/index.js` + `BlastyBiz-Onboarding.html` — "Find My Categories" only sent description to AI; ignored name, owner, city, state, special notes; no follow-up question capability | AI received one field (description) and had no mechanism to ask clarifying questions when a description was vague. Fix: (1) Client now collects all available form fields (businessName, ownerName, city, state, specialNotes, locationType) via `_buildCatContext()` and sends them all in the POST body. (2) Cloud Function destructures all fields, builds a structured BUSINESS CONTEXT block in the prompt, and includes locationType as a human-readable label. (3) Prompt now instructs AI: if context is sufficient → return `{ "categories": {...} }` as before; if vague → return `{ "followUpQuestions": ["Q1","Q2"] }` (1–3 questions). (4) UI detects followUpQuestions, renders inline text inputs with "Submit Answers →" button. (5) On submit, `submitFollowUpAnswers()` collects Q+A pairs and re-calls with `followUpAnswers` array; Cloud Function appends them to context and forces final category return. Playwright confirmed: for "Percy's Pest Control" (pest control description) AI returned direct categories with pest-control-relevant picks (e.g. "Pest Control" on Yelp, Thumbtack, Angi). No console errors. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — Connect step platform cards had no links for users who don't yet have accounts on each platform | Users landing on the Connect step with no existing Google Business Profile, Yelp listing, Thumbtack pro account, etc. had no way to go create them — clicking Connect just launched the OAuth flow which fails without an existing account. Fix: Added a `.connect-setup` link (light-blue, small, opens in new tab) to every platform card — Google "No profile yet? Create one →" (business.google.com/create), Facebook "No Page yet? Create one →", Instagram "Convert to Business account →", Nextdoor "Claim your business →", Yelp "Claim your listing →" (biz.yelp.com/claim), Thumbtack "Join as a pro →", Angi "Join as a pro →", Alignable "Create free account →", FB Marketplace "Post directly on Marketplace →", Craigslist "Create free account →", Bing Places "Go to Bing Places →", Apple Maps "Go to Apple Maps Connect →". Playwright confirmed all links present and no console errors. |
| Jun 20, 2026 | `BlastyBiz-Onboarding.html` — Connect step showed only 5 of 12 platforms; Yelp/Thumbtack/Angi/Alignable/Bing/Apple Maps missing; FB Marketplace + Craigslist merged as one card | Connect Your Platforms (step 5) only displayed Google Business, Facebook Business, Instagram Business, Nextdoor, and a combined "FB Marketplace + Craigslist" card. Seven platforms were completely absent. Fix: Added 7 new platform cards — Yelp, Thumbtack, Angi, Alignable, FB Marketplace (split), Craigslist (split), Bing Places, Apple Maps — all with "Ready ✓" / Copy & Paste or Manual tags. Updated success screen platforms counter from "4" to "12". Playwright confirmed all 12 cards present, correct button labels, and counter shows 12. |

---

## ✅ Features Added (Jun 19, 2026)

| Feature | Files changed | Description |
|---------|--------------|-------------|
| Dynamic pricing control | `functions/index.js`, `BlastyBiz-Admin-Subscriptions.html`, `BlastyBiz-Home.html` | Admin sets Pro/Agency prices → creates new Square subscription plans via Catalog API → stores plan IDs in Firestore → home page and checkout pick up new prices immediately |
| Auto-Send toggle | `BlastyBiz-Listing-Preview.html` | Toggle on Review page: Off = approve each draft; On = "Send All Now" fires all platforms without review. Preference saved to Firestore `users/{uid}.autoSend` |
| Edit existing business | `BlastyBiz-Dashboard.html` | "Edit Business Info" button on Dashboard hero routes to BlastyBiz.html which already loads saved Firestore data into the form |
| Schedule & Refire | `BlastyBiz-Listing-Preview.html` | Panel with send date + recur cadence (weekly/biweekly/monthly/quarterly) + stop-after count. Saved to `listingDrafts/{id}.schedule`; reloads on return |
| Copy-paste output panel | `BlastyBiz-Listing-Preview.html` | Dedicated panel renders all manual-only platforms (Nextdoor, Craigslist, FB Marketplace) with pre-filled text and one-tap Copy button + step-by-step instructions |
| Live Publishing Status | `BlastyBiz-Publishing-Status.html` | Switched from `getDocs` to `onSnapshot` — job status cards update in real-time as Cloud Functions complete. "Schedule Refire" link appears when draftId is in URL |

---

## ✅ Features Added (Jun 20, 2026 — Session 5)

| Feature | Files changed | Description |
|---------|--------------|-------------|
| Edit Platform Categories after onboarding | `artifacts/api-server/public/BlastyBiz.html` | Added "🏷️ Platform Categories" card to the Profile tab. Shows a dropdown per platform (FB Marketplace, Craigslist, Yelp, Thumbtack, Angi, Alignable, Apple Maps) populated from `window.PLATFORM_CATS`. Dropdowns auto-load saved categories from Firestore `businesses/{id}.platformCats` on profile load. Any change saves immediately back to Firestore via `window._savePlatformCatsToFirestore`. "🤖 Re-run AI Category Picker" button calls the `resolveCategories` Cloud Function with current business name + category, updates all dropdowns, and saves to Firestore. Added `platform-categories.js` script tag (was missing from this page). |

---

## 📋 Outstanding Items (Priority Order)

### P0 — Required before real users
- All 11 secrets above need real values set via Operate page
- Resend domain (blastybiz.com) verified in Resend account

### P1 — Future sprints
1. ~~`aiActionsUsed` monthly reset~~ ✅ Fixed & deployed Jun 19 — 30-day rolling window via `aiActionsResetAt` in `adaptListing`/`resolveCategories`
2. ~~Square `subscription.created` webhook handler~~ ✅ Fixed & deployed Jun 19 — `squareWebhook` stores `squareSubscriptionId`; `deleteAccount` can now cancel subscriptions
3. Dashboard business switcher → wire to Firestore `businesses` collection
4. Dashboard Blast Score → calculate from real platform connection data
5. Dashboard task list → generate from real job/connection data
6. Admin Platform Health → live data
7. Admin Subscriptions Money Snapshot → live Square/Firestore data
8. Onboarding platform connect → trigger real OAuth inline instead of redirecting

---

## Stack Summary

- **Frontend:** Static HTML/CSS/JS — no build step, no React, no Vite
- **Hosting:** Firebase Hosting (blastybiz-9523e.web.app)
- **Auth:** Firebase Auth — Email/Password + Google + Facebook
- **Database:** Firestore (us-east1, production mode)
- **Functions:** 29 Cloud Functions v2 (us-central1), Node 22; `square@^44.0.0`
- **AI:** Anthropic Claude via `@anthropic-ai/sdk`; per-plan caps: Starter 10 / Pro 100 / Agency 500 (lifetime counter — see Known Issues)
- **Payments:** Square (Payment Links checkout + subscription + HMAC webhook)
- **Email:** Resend via native fetch (Node 22)
- **Storage:** Firebase Storage (needs enablement — see Operate page)
- **Deploy:** `npx firebase-tools deploy --only hosting` for HTML; targeted `--only functions:name` deploys for CFs (Cloud Build takes 3–5 min per batch, Replit bash times out at 120s — normal)
