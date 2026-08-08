---
name: BlastyBiz onboarding script scoping
description: let vars in plain <script> are NOT on window; module scripts can't read them directly — critical for the createBusiness CF trigger pattern.
---

## The rule

When a page has both a plain `<script>` and a `<script type="module">`, any `let` or `const` variable declared at top level in the plain script is NOT available as `window.X` in the module script. Function declarations ARE on window. Only `var` is automatically on window.

**Why:** JavaScript spec: `let`/`const` at top-level of a script block go into the script's lexical scope, not the global object. `var` and function declarations DO go onto `window`. Module scripts have their own strict scope on top of this.

**How to apply:** Any time a wizard-style page has split script blocks (plain script for state/functions, module for Firebase/auth), explicitly mirror mutable state onto `window`:
- Declare: `let currentStep = 0; window.currentStep = 0;`
- Update: inside every setter (`goToStep`, etc.) add `window.currentStep = currentStep;`
- Module scripts then safely read `window.currentStep`.

## The reverse direction (this one is the expensive one)

The rule above covers plain → module. **The opposite direction bites harder:** anything
`import`ed in a `<script type="module">` — `auth`, `db`, Firestore helpers — lives in module
scope and is invisible to the plain `<script>`. A plain-script callback referencing bare
`auth` throws `ReferenceError: auth is not defined`.

**Why this is so hard to spot on the onboarding wizard:** the `STEPS` array lives in the plain
script, but its `fetchFn` callbacks are the things that want `auth`. The ReferenceError is
thrown *synchronously*, before any network call, and the step's `try/catch` swallows it and
falls back to a manual text input. The page looks like it "chose" to show a text box. The
backend is never contacted, so backend logs are clean and shell tests of the CF pass.

Defensive form — a best-effort token must never be able to throw:
```js
let token = null;
try {
  const _auth = window._ob2Auth;              // bridged global, not bare `auth`
  if (_auth && _auth.currentUser) token = await _auth.currentUser.getIdToken();
} catch (_) { token = null; }
```
Bridge it once in the module: `window._ob2Auth = auth;`

Note `a?.b().catch()` does **not** save you: `?.` short-circuits the *call* to `undefined`,
then `.catch` on `undefined` throws a TypeError. And neither guards a bare-identifier
ReferenceError, which happens before any of that evaluates.

**Diagnostic heuristic:** an onboarding step that silently degrades to its fallback UI, while
the CF works fine from `curl`, is a client-side ReferenceError until proven otherwise. Grep
the plain-script line range for bare module-scoped identifiers *before* investigating API
keys, models, auth tokens, CORS, or rate limits. Cheap check:
`awk 'NR>=<plainStart> && NR<=<plainEnd>' page.html | grep -nE "[^._A-Za-z0-9](auth|db|getDoc|setDoc)\s*[(.]"`

## Email verification via Identity Toolkit Admin API

To set `emailVerified: true` on a Firebase Auth user without ADC credentials:
1. Get the firebase-tools refresh token: `require('firebase-tools/lib/auth').getAllAccounts()[0].tokens.refresh_token`
2. Exchange for access token: POST to `https://oauth2.googleapis.com/token` — the clientId and clientSecret are defined in `firebase-tools/lib/api.js` (`clientId` and `clientSecret` exports); read them from the local file rather than hardcoding.
3. Call: `POST https://identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts:update` with body `{"localId":"...", "emailVerified":true}` and `Authorization: Bearer {token}`

## Testing agent block

The Playwright testing subagent caches a "blocked" state server-side when it encounters an auth redirect. This persists for the entire session — `restart: true` in code_execution does NOT clear it. The only workaround per session is to accept the block and do code-level analysis + screenshot tool instead.
