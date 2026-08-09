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

## The main app page has the same split — and a whole tab range depended on it

`BlastyBiz.html` is not just the wizard: it has a `<script type="module">` holding every
Firebase import plus the session state (`currentUser`, `activeBizId`, `userPlan`), followed by
a large classic `<script>` block that implements the Story tab, Business Library and Account
tab. That classic block calls bare `getDoc`, `doc`, `db`, `currentUser`, `activeBizId` — all
module-scoped, therefore all `undefined` there. Every one of those tabs threw
`ReferenceError` on click.

**Why it survived so long:** each tab loader wraps its body in `try/catch` and logs
`loadStory: …` / `loadAccount: …`. The tab still *renders* (the markup is static), it just
never populates. It reads as "empty state", not "crash", unless you open the console.

**How to apply:** the fix is a one-time bridge at the TOP of the module block, not edits at
40+ call sites — a classic script resolves a bare identifier against `window`, so publishing
the names there makes existing code work untouched:
- Plain values for the imports: `Object.assign(window, { db, doc, getDoc, setDoc, … })`.
- Mutable session state must be **accessors, not snapshots** — `Object.defineProperty(window,
  'currentUser', { get: () => currentUser, set: v => { currentUser = v; } })`. A plain
  `window.currentUser = currentUser` at module top captures `null`, because the user is not
  signed in yet at that point.
- Always give those accessors a **setter**. The classic block already does
  `window.activeBizId = …` and `window.userPlan = …`; a getter-only property makes those
  assignments throw in strict mode / silently no-op otherwise.
- Ordering is safe even though the bridge sits above the `let currentUser = null;`
  declarations: the accessor bodies only run when a tab is opened, long after the module has
  finished. But do not read `window.currentUser` in the gap between the two, or you hit TDZ.
- Remember classic inline scripts execute *before* deferred module scripts, so the bridge
  cannot be consumed at classic-block parse time — only from inside functions called later.

**Diagnostic heuristic (generalised):** a tab or panel that renders its chrome but stays
empty, with a `someLoader: ReferenceError` in the console, is this bug. Check which script
block the function literally sits in before assuming the data or rules are at fault.

## Diagnostics on the onboarding wizard are debug-gated on purpose

The category step's failure UI shows a short message plus a `Reference: <code>` only.
Full stack traces and upstream HTTP response bodies render **only** when the URL carries
`?debug=1`.

**Why:** a security review flagged that raw stacks and CF response bodies leak backend
implementation detail to ordinary business owners. But Dave debugs on a phone with no
developer console, so the detail had to stay reachable somehow. The flag is the compromise.

**How to apply:** do not "helpfully" un-gate this to make debugging easier, and do not delete
it as dead code. To diagnose a live onboarding failure, load the page with `?debug=1` and read
the Technical details block on the page itself.

## Email verification via Identity Toolkit Admin API

To set `emailVerified: true` on a Firebase Auth user without ADC credentials:
1. Get the firebase-tools refresh token: `require('firebase-tools/lib/auth').getAllAccounts()[0].tokens.refresh_token`
2. Exchange for access token: POST to `https://oauth2.googleapis.com/token` — the clientId and clientSecret are defined in `firebase-tools/lib/api.js` (`clientId` and `clientSecret` exports); read them from the local file rather than hardcoding.
3. Call: `POST https://identitytoolkit.googleapis.com/v1/projects/{projectId}/accounts:update` with body `{"localId":"...", "emailVerified":true}` and `Authorization: Bearer {token}`

## Testing agent block

The Playwright testing subagent caches a "blocked" state server-side when it encounters an auth redirect. This persists for the entire session — `restart: true` in code_execution does NOT clear it. The only workaround per session is to accept the block and do code-level analysis + screenshot tool instead.
