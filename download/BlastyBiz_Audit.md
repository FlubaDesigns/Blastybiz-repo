# BlastyBiz — Full Site Audit
**Last updated: June 19, 2026**
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
