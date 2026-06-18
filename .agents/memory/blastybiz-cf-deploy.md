---
name: BlastyBiz Cloud Functions deploy gotchas
description: Hard-won lessons about deploying Cloud Functions for this project — timeouts, type conflicts, npm issues
---

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
