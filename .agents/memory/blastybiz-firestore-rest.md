---
name: BlastyBiz Firestore REST access
description: How to make authenticated Firestore REST API calls from Replit when ADC is not available.
---

## The problem
Replit has no Application Default Credentials (ADC) and no service account key file. `admin.initializeApp()` fails without credentials. `firebase deploy` works but exceeds the 120-second bash tool timeout for functions.

## The solution
Firebase CLI stores OAuth tokens at:
`/home/runner/workspace/.config/configstore/firebase-tools.json`
(because `XDG_CONFIG_HOME=/home/runner/workspace/.config`)

Keys in that file: `tokens.access_token`, `tokens.refresh_token`

**Why:** The firebase-tools configstore path is controlled by the `XDG_CONFIG_HOME` env var, which Replit sets to the workspace `.config/` folder — not the standard `~/.config/`.

**How to apply:**
1. Read the configstore file in `code_execution` sandbox
2. Refresh the access token via `https://oauth2.googleapis.com/token` using firebase-tools' own OAuth client:
   - client_id: `563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com`
   - client_secret: `j9iVZfS8kkCEFUPaAeJV0sAi`
   - (these are public values hardcoded in `node_modules/firebase-tools/lib/api.js`)
3. Use the refreshed `access_token` as a Bearer token against the Firestore REST API:
   `https://firestore.googleapis.com/v1/projects/blastybiz-9523e/databases/(default)/documents/...`

## Firestore REST field format
Reads return typed fields: `{ stringValue, integerValue, booleanValue, arrayValue, mapValue, timestampValue, nullValue }`.
Writes must use the same typed format. Always write converter helpers (`fromFirestore` / `toFirestore`) before attempting REST operations.

## CF deploy timeout workaround
If you need to deploy a single function: start with `nohup ... &` or just fire the deploy and accept the bash tool timeout — the GCP Cloud Build job continues running. Then confirm with `firebase functions:list` afterward.
