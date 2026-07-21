# BlastyBiz

Local business marketing distribution tool. Business owner fills out one form, AI adapts the listing for every platform, then auto-posts or generates copy-paste content.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `npx firebase-tools deploy --only hosting` — deploy static HTML to Firebase Hosting
- `npx firebase-tools deploy --only firestore:rules` — deploy Firestore rules
- `npx firebase-tools deploy --only functions` — deploy Cloud Functions

## Mascot Component

See `mascot/README.md` for the full guide — SVG anatomy, animation class reference, composition examples, and changelog.

## Stack

- Static HTML/CSS/JS — no React, no Vite, no build step for the frontend
- Firebase Hosting — serves all static files (blastybiz-9523e.web.app)
- Firebase Auth — Email/Password + Google
- Firestore — primary database (us-east1, production mode)
- Cloud Functions — 9 functions in `functions/index.js`
- Express (API server) — `/api` routes only; runs on Replit for development
- Anthropic Claude — AI adaptation via `ANTHROPIC_API_KEY`

## Where things live

- `artifacts/api-server/public/` — all HTML pages (source of truth for static files)
- `artifacts/api-server/src/routes/` — Express API routes
- `functions/index.js` — all 9 Cloud Functions
- `firestore.rules` — Firestore security rules
- `firebase.json` — Firebase project config

## Pages

### Onboarding flow (new user journey)
| Page | URL | What it does |
|------|-----|--------------|
| `BlastyBiz-Intro.html` | `/BlastyBiz-Intro.html` | Welcome hub. Greets new vs returning users. Shows plan badge, perks panel (pro/agency), news. CTA: Dashboard / ➕ New business / Update profile. |
| `BlastyBiz-Profile.html` | `/BlastyBiz-Profile.html` | 12-step Blasty blur-spotlight wizard. Collects owner name, biz name, role, email, phone, location type, address, zip, website. Fork at end: Story or Create. Saves to `users/{uid}/businesses/{bizId}` + writes `displayName`, `email`, `onboarded`, `activeBusiness` to `users/{uid}`. |
| `BlastyBiz-Story.html` | `/BlastyBiz-Story.html` | 5-step story page (story / different / awards / customer / other). Saves `aiContext` fields to the business doc, then routes to Create. |
| `BlastyBiz-CreateBiz.html` | `/BlastyBiz-CreateBiz.html` | Quick-form campaign creator. Requires `bb_bizId` in sessionStorage. |

### Admin pages
| Page | URL | What it does |
|------|-----|--------------|
| `BlastyBiz-TestBlasty.html` | `/BlastyBiz-TestBlasty.html` | **Admin-only test console.** Full test run (clears session → Profile), individual stage launchers, session inspector/clear, links to Onboard Step Editor + Mood Presets. |
| `BlastyBiz-Admin-OnboardSteps.html` | `/BlastyBiz-Admin-OnboardSteps.html` | Edit Blasty messages + animation per step for OB1 (Profile wizard) and OB2 (Quick form). |
| `BlastyBiz-Admin-Moods.html` | `/BlastyBiz-Admin-Moods.html` | CRUD for named mascot animation presets (Greeting/Asking/Working/Happy/etc.). |

### Auth pattern for all protected pages
Every protected page must use this pattern in `<head>` — **no exceptions**:
```html
<style>body{visibility:hidden}</style>
<script type="module" src="./auth-guard.js"></script>
```
Then in the page's own module script: `await auth.authStateReady(); const user = auth.currentUser;`
Import `auth` and `db` from `./firebase-init-v2.js` only. Do NOT add separate firebase-auth or firebase-app CDN imports — `firebase-init-v2.js` handles those.

### SessionStorage keys
- `bb_answers` — JSON blob of Profile wizard answers, passed Profile → Story → Create
- `bb_bizId` — Firestore business document ID, passed Profile → Story → Create

## Open questions for Dave

1. **Multiple businesses** — when an agency user has multiple businesses, should there be a business switcher (e.g. in the dashboard header)? Currently `activeBusiness` is a single pointer on the user doc.
2. **Story skip** — Profile's fork gives a choice: go to Story or skip straight to Create. If they skip, `aiContext` fields are blank. Should Blasty nudge them to fill Story later from the dashboard?

## User preferences

- **User is Dave. I am Rep** (Replit agent). Dave works with both Rep and Anthropic Claude directly; "Rep" is this agent's name.

- **This is a Firebase + Cloud Functions build. Do NOT create Vite apps, React apps, dev servers, or any Replit-hosted frontend artifacts. Ever.**
- All frontend work goes directly to `artifacts/api-server/public/` and is deployed to Firebase Hosting.
- The only thing running on Replit is the Express API server (`artifacts/api-server`).
- Deploy with `npx firebase-tools deploy --only hosting` after any HTML changes.
- Admin pages (Queue Manager, Logs) use light/white theme — do NOT apply dark theme.

## Fix Workflow (mandatory — every fix, every time, NO EXCEPTIONS)

1. **Diagnose** — identify the root cause before touching any code.
2. **Fix** — make the code change.
3. **Deploy to Firebase** — run `npx firebase-tools deploy --only hosting` for HTML/JS changes; deploy individual functions for Cloud Function changes.
4. **Confirm** — verify the fix is actually live (e.g. `curl` the deployed file and check the output). Do not assume it worked.
5. **VERIFY** — Use `curl` to confirm the deployed file/response reflects the fix. Use Playwright (`runTest()`) when the bug involves browser-side JavaScript execution, console errors, or UI behavior that curl cannot catch (e.g. SyntaxErrors, module failures, auth-guard redirects). Use the Firestore REST-API token-refresh technique to verify Firestore state. Skipping verification entirely is not allowed. If verification fails, go back to step 1.
6. **Update `download/BlastyBiz_Audit.md`** — add a row to the 🐛 Bugs Fixed table with date, location, and what was wrong and how it was fixed.
7. **Rebuild `download/BlastyBiz_Site.zip`** — run the Python zipfile script so the zip always reflects the latest state.
8. **Present both files** to the user before closing out the fix.
9. **Post the live link** — always end with the direct URL so it can be tapped on mobile: https://blastybiz-9523e.web.app

## Gotchas

- `firebase deploy` works from Replit — Firebase CLI is already authenticated.
- Firestore rules: `businesses` collection checks `uid` field on the document, not the document ID.
- `ANTHROPIC_API_KEY` is set as a Replit env var (shared environment).
- Cloud Functions require Firebase Blaze plan to deploy.
- Never create new Replit artifacts for this project.
