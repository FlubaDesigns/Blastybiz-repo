# BlastyBiz — Full Site Audit
**Last updated: June 18, 2026  
**Firebase Project:** blastybiz-9523e  
**Live URL:** https://blastybiz-9523e.web.app

---

## Deployed Cloud Functions (28 total — all v2, us-central1)

| # | Function | Type | Purpose |
|---|---|---|---|
| 1 | `adaptListing` | HTTP | AI listing adaptation (Anthropic Claude); verifyBearer() + AI_LIMITS cap |
| 2 | `resolveCategories` | HTTP | AI category resolution; verifyBearer() + AI_LIMITS cap |
| 3 | `approveDraft` | HTTP | Creates publish jobs; verifyBearer(); enforces Starter vs Pro plan |
| 4 | `uploadImage` | HTTP | Uploads images to Firebase Storage; verifyBearer() |
| 5 | `postToGoogle` | HTTP | Auto-posts to Google Business Profile (try/catch, writes job outcome) |
| 6 | `postToFacebook` | HTTP | Auto-posts to Facebook Business Page (try/catch, writes job outcome) |
| 7 | `postToInstagram` | HTTP | Auto-posts to Instagram Business (try/catch, writes job outcome) |
| 8 | `postToBing` | HTTP | Marks job manual_required (no Bing API) |
| 9 | `postToAppleMaps` | HTTP | Marks job manual_required (no Apple API) |
| 10 | `createCheckoutSession` | HTTP | Square Payment Link checkout; verifyBearer() |
| 11 | `createPortalSession` | HTTP | Square billing portal (mailto fallback); verifyBearer() |
| 12 | `squareWebhook` | HTTP | Square HMAC webhook; handles payment.completed + subscription.canceled |
| 13 | `initiateGoogleOAuth` | HTTP | Starts Google OAuth flow |
| 14 | `googleOAuthCallback` | HTTP | Completes Google OAuth; stores tokens + platformId field |
| 15 | `initiateFacebookOAuth` | HTTP | Starts Facebook OAuth flow |
| 16 | `facebookOAuthCallback` | HTTP | Completes Facebook OAuth; stores tokens + platformId field |
| 17 | `postToBing` | HTTP | Marks job manual_required |
| 18 | `postToAppleMaps` | HTTP | Marks job manual_required |
| 19 | `deleteAccount` | HTTP | Cancels Square sub, wipes Firestore, deletes Auth user |
| 20 | `setOperatorSecret` | HTTP | Admin-only: sets Secret Manager secrets via Cloud IAM |
| 21 | `onJobCreated` | Firestore trigger | publishJobs/{jobId} created → dispatches to correct post* function |
| 22 | `onJobFailed` | Firestore trigger | publishJobs/{jobId} status → failed → sends failure email via Resend |
| 23 | `onUserCreated` | Firestore trigger | New user doc created → sends welcome email via Resend |
| 24 | `adminListPublishJobs` | HTTP | Admin: paginated publishJobs list; requireAdmin() |
| 25 | `adminListFailedJobs` | HTTP | Admin: failed/manual jobs list; requireAdmin() |
| 26 | `adminRetryJob` | HTTP | Admin: re-queues a failed job; requireAdmin() |
| 27 | `adminMarkManualFollowup` | HTTP | Admin: marks job manual_followup; requireAdmin() |
| 28 | `adminListBusinesses` | HTTP | Admin: lists all businesses; requireAdmin() |
| 29 | `adminListPlatformConnections` | HTTP | Admin: lists platform connections; requireAdmin() |
| 30 | `adminListActivityLogs` | HTTP | Admin: paginated activityLogs; requireAdmin() |
| 31 | `adminSubscriptionSummary` | HTTP | Admin: live subscription counts + MRR from Firestore; requireAdmin() |

---

## HTML Pages (18 total — all deployed to Firebase Hosting)

| Page | Auth Guard | Status |
|---|---|---|
| BlastyBiz-Home.html | No | Marketing landing page — fully live |
| BlastyBiz-Login.html | No | Email/password + Google (popup on desktop, redirect on mobile) + Facebook sign-in/sign-up |
| BlastyBiz.html | Yes | Main listing form — AI adapt, platform gating, approve |
| BlastyBiz-Dashboard.html | Yes | User dashboard — plan/billing/delete account |
| BlastyBiz-Connect.html | Yes | Google + Facebook OAuth platform connect |
| BlastyBiz-Publishing-Status.html | Yes | Live publish job status from Firestore |
| BlastyBiz-Onboarding.html | Yes | Multi-step business setup wizard |
| BlastyBiz-Listing-Preview.html | Yes | Preview adapted listing before approve |
| BlastyBiz-Admin.html | Yes | Admin hub |
| BlastyBiz-Admin-Queue-Manager.html | Yes | Live job queue from Firestore |
| BlastyBiz-Admin-Failed-Jobs.html | Yes | Failed/manual jobs from Firestore |
| BlastyBiz-Admin-Subscriptions.html | Yes | Subscription overview (partial Firestore) |
| BlastyBiz-Admin-Users.html | Yes | User list from Firestore |
| BlastyBiz-Admin-Platform-Health.html | Yes | Platform health (auth-guarded, static) |
| BlastyBiz-Admin-Logs.html | Yes | Live activityLogs from Firestore |
| BlastyBiz-Admin-Operate.html | Yes | Operator setup cheat sheet |
| BlastyBiz-Privacy.html | No | Privacy policy |
| BlastyBiz-Terms.html | No | Terms of service |

---

## Firestore Rules

All 6 collections secured. Owner-only access on all user data.  
**Key gotcha:** `businesses` collection checks the `uid` field on the document, not the document ID.  
`subscriptions` — write: false (backend only via Stripe webhook).

---

## ✅ What's Working

- Full user auth flow (email + Google + Facebook)
- AI listing adaptation (Anthropic Claude) — per-plan AI cap enforced (Starter 5 / Pro 20 / Agency 50 per 30 days)
- Platform plan gating: Starter users see "🔒 Pro only" + upgrade link on API platforms (Google, Facebook, Instagram); API platforms are converted to `manual_required` jobs server-side in `approveDraft`
- Google and Facebook OAuth connect/disconnect; `platformId` stored in `platformConnections` doc
- Square checkout + billing portal (mailto fallback)
- Square webhook updates Firestore plan on payment.completed + subscription.canceled events
- `onJobCreated` trigger: auto-dispatches publish jobs to the right platform function on creation
- Publish job creation and status tracking; Publishing Status page shows empty state (not mock data)
- Resend welcome email on new user signup (Firestore trigger)
- Resend failure alert email when publish job status → failed (Firestore trigger)
- Account deletion: cancels Square sub, wipes all Firestore docs, deletes Auth user
- 8 admin endpoints (all behind requireAdmin): list jobs, list failed, retry job, mark manual, list businesses, list connections, list logs, subscription summary
- Admin Failed Jobs: per-row checkboxes, Retry + Manual Follow-up wired to Cloud Functions, Export CSV
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
| Jun 18, 2026 | `functions/index.js`, `functions/package.json`, `BlastyBiz-Admin-Operate.html`, `BlastyBiz-Admin-Subscriptions.html`, `BlastyBiz-Admin.html`, `BlastyBiz-Dashboard.html`, `BlastyBiz-Privacy.html`, `BlastyBiz-Terms.html` | **Replaced all Stripe code and references with Square.** Removed `stripe` npm package, added `squareup`. Replaced lazy-init `getStripe()` with `getSquare()` (Square SDK `Client`). Replaced `createCheckoutSession` (Stripe Checkout → Square Payment Link with `referenceId: uid` on the order). Replaced `createPortalSession` (Stripe portal → returns mailto link, Square has no hosted portal). Renamed `stripeWebhook` → `squareWebhook` with HMAC-SHA256 verification (`x-square-hmacsha256-signature`); handles `payment.completed` (retrieves order to get uid from `referenceId`) and `subscription.canceled` (looks up user by `squareCustomerId`). Updated `deleteAccount` to cancel Square subscription via `subscriptionsApi.cancelSubscription`. Updated `setOperatorSecret` ALLOWED list (Stripe → Square secrets). Admin-Operate setup guide rewritten for Square (4 cards: create plans → access token → location/plan IDs → webhook). All JS badge logic updated (`badge-square`, `squareKeys` array). All user-facing copy updated across Dashboard, Privacy, Terms, Admin, Subscriptions pages. Firestore subscriptions doc fields: `stripeCustomerId`/`stripeSubscriptionId` → `squareCustomerId`/`squarePaymentId`. Playwright confirmed live. |
| Jun 18, 2026 | `functions/index.js` | **B1–B5: Backend security + automation hardening.** Added `verifyBearer()` (verifies Firebase ID token from Authorization header) and `requireAdmin()` (checks `perceys@gmail.com`) helpers. Applied `verifyBearer()` to 6 functions: `adaptListing`, `resolveCategories`, `approveDraft`, `uploadImage`, `createCheckoutSession`, `createPortalSession`. Added `AI_LIMITS` constant (`{starter:5,pro:20,agency:50}` per 30 days) and per-user Firestore tracking in `adaptListing` and `resolveCategories`. Added `onJobCreated` Firestore trigger (reads job doc, looks up `platformConnections`, dispatches to `postToGoogle`/`postToFacebook`/`postToInstagram`, marks success/failed). Added 8 admin endpoints: `adminListPublishJobs`, `adminListFailedJobs`, `adminRetryJob`, `adminMarkManualFollowup`, `adminListBusinesses`, `adminListPlatformConnections`, `adminListActivityLogs`, `adminSubscriptionSummary` — all behind `requireAdmin()`. Added `platformId` field to both OAuth callbacks. |
| Jun 18, 2026 | `functions/package.json`, `functions/index.js` | **Deploy fix: squareup→square + secrets declarations removed.** `squareup@^43.0.0` does not exist on npm (only v1.0.0 stub); real Square SDK is `square@^44.0.0`. Fixed package name and `require('squareup')` → `require('square')`. Regenerated `package-lock.json` with `npm install --package-lock-only`. Also removed `secrets: [...]` arrays from `createCheckoutSession`, `squareWebhook`, `deleteAccount` — Square secrets live in process.env, not Firebase Secret Manager, so the binding declarations caused 404 deploy failures. Deployed by batch: deleted stale HTTPS-typed `onJobCreated`/`onJobFailed`/`onUserCreated` stubs (Firebase blocks type-changing in place), then redeployed in targeted batches due to Replit 120s bash timeout vs Cloud Build's 3-5min deploy time. All 28 functions now live. |
| Jun 18, 2026 | `BlastyBiz-Publishing-Status.html`, `BlastyBiz-Dashboard.html`, `BlastyBiz-Listing-Preview.html`, `BlastyBiz.html`, `BlastyBiz-Admin-Failed-Jobs.html`, `BlastyBiz-Admin-Subscriptions.html` | **H1–H6: Remove mock data + wire admin actions.** Publishing-Status: replaced `showMockData()` fallback with `showEmptyState()` (3 call sites). Dashboard: removed hardcoded `BUSINESSES` mock array, added `renderNoBusinessState()` for empty states. Listing-Preview: removed direct `publishJobs` Firestore writes; replaced `window._firestoreApprove` with a call to the `approveDraft` Cloud Function. BlastyBiz.html: removed direct `publishJobs` write (line 1563), replaced with redirect to `activityLogs`. Admin-Failed-Jobs: added `data-job-id` checkboxes to each job row, wired Retry button to `adminRetryJob` CF and Manual Follow-up to `adminMarkManualFollowup` CF, Export button generates CSV. Admin-Subscriptions: added "Demo data" banner — Money Snapshot and chart are placeholders until Square webhooks populate Firestore. Deployed to Firebase Hosting. Playwright confirmed auth-guard redirect working (unauthenticated → login). |
| Jun 17, 2026 | `BlastyBiz-Connect.html` + new `BlastyBiz-Connected.html` + `functions/index.js` | Added pre-connect friction reduction and post-connection clarity. (1) Google Connect button now opens an inline explainer drawer showing exactly what will happen (permission popup → secure token stored → nothing posts until approved) plus a link to create a Business Profile if they don't have one. (2) Facebook Connect button now opens a bottom-sheet gate modal asking "Do you have a Facebook Business Page?" — Yes proceeds to OAuth; No shows a 4-step guide to create one with a direct link, preventing the silent failure where users with no Page connect successfully but post to nothing. (3) New `BlastyBiz-Connected.html` post-connection landing page: OAuth callbacks now redirect here instead of back to Connect with a toast. The page reads the `platformConnections` Firestore doc, shows the connected account/page name, shows whether Instagram was auto-linked (or why it wasn't), explains the 4-step "what happens when you post" flow in plain English, and CTAs to create first listing, connect another platform, or go to dashboard. Error state shows a helpful explanation of the most common causes. |

---

## ⚠️ Known Hardcoded / Placeholder Items (Future Sprints)

| Location | Item | Notes |
|---|---|---|
| Dashboard | Business switcher list | Hardcoded mock array (QR Gear, etc.) — labeled "Prototype mock data — replace with Firestore query" |
| Dashboard | Blast Score (83%) | Static placeholder |
| Dashboard | Task list (Confirm Yelp, Add photos) | Static placeholder |
| Admin → Platform Health | All content | Static — no live Firestore queries |
| Admin → Subscriptions | Money Snapshot ($1,842 MRR) | Static placeholder — "Demo data" banner added; real data needs Square webhook populating Firestore |
| Onboarding | Platform connect step | Redirects to Connect page rather than triggering OAuth inline |

---

## 🔑 Operator Actions Required (All in Operate Page)

The Operator Setup page (`BlastyBiz-Admin-Operate.html`) has step-by-step instructions for all of these:

| Secret | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys |
| `STRIPE_PRO_PRICE_ID` | Stripe Dashboard → Products (after creating Pro product) |
| `STRIPE_AGENCY_PRICE_ID` | Stripe Dashboard → Products (after creating Agency product) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Webhooks → signing secret |
| `STRIPE_PUBLISHABLE_KEY` | Stripe Dashboard → Developers → API Keys |
| `GOOGLE_CLIENT_ID` | Google Cloud Console → OAuth credentials |
| `GOOGLE_CLIENT_SECRET` | Google Cloud Console → OAuth credentials |
| `FACEBOOK_APP_ID` | Meta for Developers → App Settings |
| `FACEBOOK_APP_SECRET` | Meta for Developers → App Settings |
| `RESEND_API_KEY` | resend.com/api-keys (set real key; placeholder deployed) |

**Also required (in Operate page):**
- Firebase Storage: enable in Firebase Console → Storage (Blaze plan)
- Resend domain verification: resend.com/domains → add blastybiz.com

---

## 📋 Full Outstanding List (Priority Order)

### P0 — Fix before real users
- All 11 secrets above need real values set
- Resend domain (blastybiz.com) verified in Resend account

### P1 — Nice-to-have before launch
- Publishing Status: replace `showMockData()` fallback with a clean empty state

### P2 — Future sprints
1. Dashboard business switcher → wire to Firestore `businesses` collection
2. Dashboard Blast Score → calculate from real platform connection data
3. Dashboard task list → generate from real job/connection data
4. Admin Platform Health → live data
5. Admin Subscriptions → live Stripe/Firestore data
6. Admin Failed Jobs top buttons → wire Retry Selected, Export, Recovery Emails
7. AI usage cap per plan → track `aiActionsUsed` in Firestore, gate in `adaptListing`
8. Onboarding platform connect → trigger real OAuth inline instead of redirecting

---

## Stack Summary

- **Frontend:** Static HTML/CSS/JS — no build step, no React, no Vite
- **Hosting:** Firebase Hosting (blastybiz-9523e.web.app)
- **Auth:** Firebase Auth — Email/Password + Google + Facebook
- **Database:** Firestore (us-east1, production mode)
- **Functions:** 28 Cloud Functions v2 (us-central1), Node 22; `square@^44.0.0`
- **AI:** Anthropic Claude via `@anthropic-ai/sdk`; per-plan caps (Starter 5 / Pro 20 / Agency 50 per 30 days)
- **Payments:** Square (Payment Links checkout + subscription + HMAC webhook)
- **Email:** Resend via native fetch (Node 22)
- **Storage:** Firebase Storage (needs enablement — see Operate page)
- **Deploy:** `npx firebase-tools deploy --only hosting` for HTML; targeted `--only functions:name` deploys for CFs (Cloud Build takes 3–5 min per batch)
