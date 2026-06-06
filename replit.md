# BlastyBiz

Local business marketing distribution tool. Business owner fills out one form, AI adapts the listing for every platform, then auto-posts or generates copy-paste content.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `npx firebase-tools deploy --only hosting` — deploy static HTML to Firebase Hosting
- `npx firebase-tools deploy --only firestore:rules` — deploy Firestore rules
- `npx firebase-tools deploy --only functions` — deploy Cloud Functions

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

## User preferences

- **This is a Firebase + Cloud Functions build. Do NOT create Vite apps, React apps, dev servers, or any Replit-hosted frontend artifacts. Ever.**
- All frontend work goes directly to `artifacts/api-server/public/` and is deployed to Firebase Hosting.
- The only thing running on Replit is the Express API server (`artifacts/api-server`).
- Deploy with `npx firebase-tools deploy --only hosting` after any HTML changes.
- Admin pages (Queue Manager, Logs) use light/white theme — do NOT apply dark theme.

## Fix Workflow (mandatory — every fix, every time)

1. **Diagnose** — identify the root cause before touching any code.
2. **Fix** — make the code change.
3. **Deploy to Firebase** — run `npx firebase-tools deploy --only hosting` for HTML/JS changes; deploy individual functions for Cloud Function changes.
4. **Confirm** — verify the fix is actually live (e.g. `curl` the deployed file and check the output). Do not assume it worked.
5. **Update `download/BlastyBiz_Audit.md`** — add a row to the 🐛 Bugs Fixed table with date, location, and what was wrong and how it was fixed.
6. **Rebuild `download/BlastyBiz_Site.zip`** — run the Python zipfile script so the zip always reflects the latest state.
7. **Present both files** to the user before closing out the fix.

## Gotchas

- `firebase deploy` works from Replit — Firebase CLI is already authenticated.
- Firestore rules: `businesses` collection checks `uid` field on the document, not the document ID.
- `ANTHROPIC_API_KEY` is set as a Replit env var (shared environment).
- Cloud Functions require Firebase Blaze plan to deploy.
- Never create new Replit artifacts for this project.
