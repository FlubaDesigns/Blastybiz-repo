# BlastyBiz — Full Site Audit
**Last updated:** June 6, 2026  
**Firebase Project:** blastybiz-9523e  
**Live URL:** https://blastybiz-9523e.web.app

---

## Deployed Cloud Functions (19 total — all v2, us-central1)

| # | Function | Type | Purpose |
|---|---|---|---|
| 1 | `adaptListing` | HTTP | AI listing adaptation via Anthropic Claude |
| 2 | `resolveCategories` | HTTP | AI category resolution via Anthropic |
| 3 | `approveDraft` | HTTP | Creates publish jobs; enforces Starter vs Pro plan |
| 4 | `uploadImage` | HTTP | Uploads images to Firebase Storage |
| 5 | `postToGoogle` | HTTP | Auto-posts to Google Business Profile |
| 6 | `postToFacebook` | HTTP | Auto-posts to Facebook Business Page |
| 7 | `postToInstagram` | HTTP | Auto-posts to Instagram Business |
| 8 | `postToBing` | HTTP | Marks job manual_required (no Bing API) |
| 9 | `postToAppleMaps` | HTTP | Marks job manual_required (no Apple API) |
| 10 | `createCheckoutSession` | HTTP | Stripe checkout session creation |
| 11 | `createPortalSession` | HTTP | Stripe billing portal |
| 12 | `stripeWebhook` | HTTP | Handles Stripe events, updates Firestore plan |
| 13 | `initiateGoogleOAuth` | HTTP | Starts Google OAuth flow |
| 14 | `googleOAuthCallback` | HTTP | Completes Google OAuth, stores tokens |
| 15 | `initiateFacebookOAuth` | HTTP | Starts Facebook OAuth flow |
| 16 | `facebookOAuthCallback` | HTTP | Completes Facebook OAuth, stores tokens |
| 17 | `onJobFailed` | Firestore trigger | Sends failure email via Resend when job status → failed |
| 18 | `onUserCreated` | Firestore trigger | Sends welcome email via Resend on new user doc |
| 19 | `deleteAccount` | HTTP | Cancels Stripe sub, wipes Firestore, deletes Auth user |

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
- AI listing adaptation (Anthropic Claude)
- Platform plan gating: Starter users see "🔒 Pro only" + upgrade link on API platforms (Google, Facebook, Instagram); API platforms are converted to `manual_required` jobs server-side in `approveDraft`
- Google and Facebook OAuth connect/disconnect
- Stripe checkout + billing portal
- Stripe webhook updates Firestore plan on subscription events
- Publish job creation and status tracking
- Resend welcome email on new user signup (Firestore trigger)
- Resend failure alert email when publish job status → failed (Firestore trigger)
- Account deletion: cancels Stripe sub, wipes all Firestore docs, deletes Auth user
- Admin queue, failed jobs, logs — all reading from Firestore live

---

## 🐛 Bugs Fixed

| Date | Location | Fix |
|---|---|---|
| Jun 6, 2026 | `deleteAccount` CF | Was missing `secrets: ['STRIPE_SECRET_KEY']` — Stripe cancellation would silently fail. Fixed and redeployed. |
| Jun 6, 2026 | `BlastyBiz-Login.html` | Google sign-in used `signInWithPopup` on all devices — blocked by mobile Chrome. Fixed: `signInWithRedirect` on mobile (Android/iPhone), `signInWithPopup` retained on desktop. |
| Jun 6, 2026 | `firebase-init.js` | `authDomain` was `blastybiz-9523e.firebaseapp.com` — mobile Chrome blocks cross-origin storage between `firebaseapp.com` and `web.app`, silently killing the redirect flow. Fixed: changed `authDomain` to `blastybiz-9523e.web.app` so auth redirect stays same-origin. Verified live. |

---

## ⚠️ Known Hardcoded / Placeholder Items (Future Sprints)

| Location | Item | Notes |
|---|---|---|
| Dashboard | Business switcher list | Hardcoded mock array (QR Gear, etc.) — labeled "Prototype mock data — replace with Firestore query" |
| Dashboard | Blast Score (83%) | Static placeholder |
| Dashboard | Task list (Confirm Yelp, Add photos) | Static placeholder |
| Publishing Status | `showMockData()` fallback | Called when no real jobs exist — shows sample data instead of empty state |
| Admin → Platform Health | All content | Static — no live Firestore queries |
| Admin → Subscriptions | Money Snapshot ($1,842 MRR) | Static placeholder numbers |
| Admin → Failed Jobs | Top action buttons | Retry Selected, Export Errors — onclick handlers not wired |
| BlastyBiz.html | AI usage cap | No per-plan limit on `adaptListing` calls — all plans unlimited |
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
- **Functions:** 19 Cloud Functions v2 (us-central1), Node 22
- **AI:** Anthropic Claude via `@anthropic-ai/sdk`
- **Payments:** Stripe (checkout + portal + webhooks)
- **Email:** Resend via native fetch (Node 22)
- **Storage:** Firebase Storage (needs enablement — see Operate page)
- **Deploy:** `npx firebase-tools deploy --only hosting` for HTML; per-function deploys for CFs
