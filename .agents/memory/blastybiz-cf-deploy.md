---
name: BlastyBiz Cloud Functions deploy gotchas
description: Hard-won lessons about deploying Cloud Functions for this project — timeouts, type conflicts, npm issues
---

## Rule 8: GEMINI_API_KEY format and models
- API keys from AI Studio start with `AQ.` (not `AIza`) — still valid
- Use `?key=<apikey>` in the URL for native Gemini API, NOT `Authorization: Bearer`  
- `callAI` uses `Authorization: Bearer` (OpenAI-compat path) — this returns 401 for this key type; use native API for `suggestCategory`
- Working model as of 2026-08-08: `gemini-flash-lite-latest`
- `thinkingConfig` is NOT supported on `/v1beta/models/...generateContent` endpoint
- After updating a secret via `firebase functions:secrets:set`, must redeploy ALL functions that use it

## Rule 7 — "npm error Exit handler never called!" — delete package-lock.json
When Cloud Build's npm_modules layer is a CACHE MISS, it runs `npm ci`. If `npm ci` fails with "Exit handler never called!" (no package-specific error shown), delete `functions/package-lock.json` and redeploy. Without a lock file, the buildpack falls back to `npm install`, which succeeds.

**Why:** `npm ci` in this project's Cloud Build environment hits a bug where a package's install script exits abnormally (likely the `square` or `@anthropic-ai/sdk` postinstall under NODE_ENV=production), killing npm before its exit handler runs. `npm install` is more tolerant and completes successfully.

**How to apply:** Any time you see this error in Cloud Build logs, `rm functions/package-lock.json` then redeploy. Do NOT regenerate the lock file first — just delete it and let Cloud Build use `npm install`.

## Rule 9 — background deploys die; files from timed-out shell calls vanish
A `nohup`/`setsid` firebase deploy backgrounded from a shell call is unreliable: if the launching shell call times out (exit -1), its created files (and possibly the process) do not persist, and full 28-function deploys hang forever in the CLI's operation poller. Reliable pattern: deploy in the FOREGROUND with `timeout 280` in batches of ≤3 functions per call (`--only functions:a,functions:b,functions:c`), plus hosting alone — each completes in 2–4 min. Always make the launching command exit 0 quickly if backgrounding is unavoidable.

## Rule 1 — Replit bash timeout vs Cloud Build
Cloud Build takes 3–5 minutes to build + deploy all 28 functions. Replit's max bash timeout is 120s. The deploy command will always time out at Replit's side, but Cloud Build continues on Google's servers and completes successfully. Strategy: fire the deploy, let it "time out", then `sleep 90` and check `firebase-tools functions:list` to confirm.

**Why:** Every full-deploy attempt in a single bash call fails with timeout even though the deploy succeeds in Cloud Build.

**How to apply:** For full deploys, use `--only functions:name1,functions:name2` targeted batches (≤5 functions per batch) to stay under 120s. For large batches, accept the timeout and poll with `functions:list`.

## Rule 2 — HTTPS → Firestore trigger type conflict
Firebase v2 blocks changing a deployed function from HTTPS type to a background-triggered type in place. Error: "Changing from an HTTPS function to a background triggered function is not allowed."

**Why:** Firebase Cloud Run resources have a fixed trigger type; you can't mutate it.

**How to apply:** Before deploying a function whose type is changing, run `firebase-tools functions:delete <name> --region us-central1 --force` first. Confirm deletion with `functions:list`, then redeploy. Affected functions: `onJobCreated`, `onJobFailed`, `onUserCreated`.

## Rule 3 — Square npm package name
The Square SDK npm package is `square` (NOT `squareup`). `squareup` is a stub package with only v1.0.0. Current version: `square@^44.0.0`. Import: `require('square')`, destructure `{ Client, Environment }`.

**Why:** Previous deploy used `squareup@^43.0.0` which doesn't exist, causing Cloud Build npm install to fail.

## Rule 4 — Lock file sync without downloading packages
When `package.json` changes (e.g. `squareup` → `square`), Cloud Build runs `npm ci` which requires `package-lock.json` to be in sync. Regenerate it without downloading packages: `npm install --package-lock-only` (fast, ~5s). If `node_modules` is corrupt, use `npm install --ignore-scripts` to skip slow postinstall hooks.

## Rule 5 — secrets: [] declarations in function config
Do NOT add `secrets: ['SQUARE_ACCESS_TOKEN', ...]` to function option objects unless the secret actually exists in Firebase Secret Manager. These declarations cause Firebase CLI to validate Secret Manager at deploy time — if the secret doesn't exist, deploy fails with 404. Functions reading from `process.env.*` directly do not need the `secrets:` binding; just remove it.

## Rule 6 — Cloud Functions default (compute) service account is missing IAM roles by default
Gen2 Cloud Functions run as `{project-number}-compute@developer.gserviceaccount.com`, NOT the Firebase Admin SDK service account (`firebase-adminsdk-fbsvc@...`). Admin SDK calls that need elevated IAM (e.g. `admin.auth().deleteUser()`) silently fail with `auth/insufficient-permission` if the compute SA lacks the matching role (e.g. `roles/firebaseauth.admin`), even though the Admin SDK's own service account has it.

**Why:** Two different service accounts exist in every Firebase project — the compute default (used at Cloud Functions runtime) and the Admin SDK one (used for local/admin tooling) — and IAM roles must be granted to the one actually executing the code. This bug shipped silently for weeks: `deleteAccount` always wiped Firestore data successfully but never actually deleted the Auth user, and the error was swallowed into a generic 500 with no visible symptom to the end user.

**How to apply:** When any Admin SDK call inside a deployed Cloud Function needs elevated permissions, check IAM bindings on `{project-number}-compute@developer.gserviceaccount.com` (via Cloud Resource Manager `getIamPolicy`/`setIamPolicy` REST, since `gcloud` isn't available in this environment) — don't assume it inherits the Admin SDK service account's roles.
