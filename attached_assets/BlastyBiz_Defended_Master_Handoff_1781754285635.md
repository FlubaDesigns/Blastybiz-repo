# BLASTYBIZ - DEFENDED MASTER BETA-PRODUCTION HANDOFF

**Project:** `blastybiz-9523e`  
**Source package audited:** `BlastyBiz_Full.zip`  
**Existing handoff audited:** `BlastyBiz_Honest_Handoff.md`  
**Purpose:** One defensible, code-backed implementation handoff that keeps what the existing handoff got right, corrects what it got wrong, and adds new findings that are provable from the code.

---

## 1. Executive conclusion

BlastyBiz is a real SaaS build, not a mockup. The zip contains a Firebase Hosting site, Firestore rules, Cloud Functions, Auth integration, Anthropic AI adaptation, Stripe billing functions, Google OAuth, Facebook OAuth, Instagram account linking, a listing workflow, publishing status screens, admin screens, and operator setup pages.

However, the product is not beta-production safe yet because the main commercial promise is not fully closed:

> The app can create `publishJobs`, but the backend does not contain a processor that automatically consumes newly created pending jobs and dispatches them to Google, Facebook, or Instagram.

The existing handoff correctly found that major blocker. This document keeps that finding. It also corrects several implementation instructions in the existing handoff that do not match the actual code, and adds additional code-backed blockers around authentication, admin permissions, duplicate job creation paths, and schema consistency.

### Current beta readiness estimate

| Area | Defended estimate | Why |
|---|---:|---|
| Firebase architecture | 85-90% | Hosting, functions, Firestore rules, Auth, Stripe, AI, OAuth all exist. |
| Customer-facing UI | 80-85% | Core pages exist, but Dashboard and Publishing Status still show mock/fallback states. |
| Publishing pipeline | 55-65% | Job creation exists; true automatic job processing is missing. |
| Admin operations | 50-60% | Admin pages exist, but global browser queries conflict with owner-only rules. |
| Security hardening | 55-65% | Some functions verify tokens, but several user-level functions trust body-supplied `uid`. |
| Commercial beta readiness today | 72-78% | Strong shell, but core workflow and trust boundaries need closure. |
| Commercial beta readiness after P0 fixes | 85%+ | Once processor, auth, admin access, and fake-data cleanup are fixed, beta is realistic. |

---

## 2. Audit method and scope

### Files reviewed for this handoff

The zip contains 92 files. The most important production files reviewed were:

- `functions/index.js` - 760 lines
- `firestore.rules` - 67 lines
- `download/BlastyBiz_Audit.md` - 171 lines
- `artifacts/api-server/public/BlastyBiz.html` - 1,613 lines
- `artifacts/api-server/public/BlastyBiz-Onboarding.html` - 1,390 lines
- `artifacts/api-server/public/BlastyBiz-Home.html` - 1,041 lines
- `artifacts/api-server/public/BlastyBiz-Login.html` - 942 lines
- `artifacts/api-server/public/BlastyBiz-Admin-Operate.html` - 869 lines
- `artifacts/api-server/public/BlastyBiz-Dashboard.html` - 781 lines
- `artifacts/api-server/public/BlastyBiz-Connect.html` - 480 lines
- `artifacts/api-server/public/BlastyBiz-Publishing-Status.html` - 382 lines
- `artifacts/api-server/public/BlastyBiz-Listing-Preview.html` - 340 lines
- Admin pages: Failed Jobs, Queue Manager, Users, Subscriptions, Platform Health, Logs
- Auth/init/config files: `auth-guard.js`, `firebase-init-v2.js`, `firebase.json`, `.firebaserc`
- Existing handoff: `BlastyBiz_Honest_Handoff.md` - 647 lines

### What this document does

For each major claim from the existing handoff, this document marks it as:

- **Verified** - claim matches the actual code.
- **Partially verified** - core claim is right, but implementation guidance is incomplete or wrong.
- **Disagree / correct** - claim or fix conflicts with actual code.
- **New finding** - not adequately covered in the existing handoff, but code-backed.

---

## 3. Verification matrix against the existing handoff

| Existing handoff claim | Verdict | Code evidence | Final direction |
|---|---|---|---|
| Missing job processor for `publishJobs` | **Verified** | `approveDraft` creates `publishJobs` at `functions/index.js` lines 171-196. `postToGoogle`, `postToFacebook`, `postToInstagram` exist at lines 222, 240, 255. Only publish-job trigger is `onJobFailed` at line 568. | Keep finding. Add processor, but improve design beyond the original suggested trigger. |
| `Publishing Status` mock fallback is unsafe | **Verified** | `BlastyBiz-Publishing-Status.html` has `showMockData()` at lines 319-328 and calls it at lines 369 and 376. | Keep finding. Replace with real empty/error states. |
| Existing `Publishing Status` fix is correct | **Disagree / correct** | Original fix targets `jobs-container`, but actual page IDs are `loading-state`, `content-state`, `progress-count`, `progress-bar`, `platform-list`, `action-card`, `action-items`. | Do not use the original replacement as written. |
| Failed Jobs bulk buttons are unwired | **Verified** | `BlastyBiz-Admin-Failed-Jobs.html` line 7 has buttons with no `onclick`. | Keep finding. |
| Existing Failed Jobs bulk-button fix is correct | **Disagree / correct** | Original fix expects `.job-checkbox` and `tr[data-job-id]`, but actual generated rows at lines 52-59 have neither. | Add checkboxes/data attributes or use backend admin endpoints. |
| Admin subscriptions use static numbers | **Verified** | `BlastyBiz-Admin-Subscriptions.html` line 8 has static `$1,842`, `$126`, `86%`, `12`. | Keep finding; label or replace. |
| Dashboard mock business fallback is real | **Verified** | `BlastyBiz-Dashboard.html` comment says prototype mock data at line 318; fallback uses `window.BUSINESSES = BUSINESSES` at lines 527 and 531. | Keep finding. |
| Existing Dashboard empty-state fix is sufficient | **Partially verified** | Setting `window.BUSINESSES = []` alone conflicts with logic that assumes `BUSINESSES[0]` exists around lines 332 and 350. | Fix all downstream empty-state assumptions. |
| AI usage cap missing | **Verified** | `adaptListing` at `functions/index.js` lines 78-121 calls Anthropic with no auth, usage counter, or plan cap. | Keep finding; fix securely. |
| Existing AI cap fix is secure | **Disagree / correct** | Proposed fix accepts `uid` from request body. Existing code already has too much body-supplied UID trust. | Derive UID from verified Firebase ID token, not request body. |
| Google OAuth stores tokens | **Verified but not fully hardened** | Google callback stores access token, refresh token, accountId, locationId at `functions/index.js` lines 401-421. | Keep. Add state hardening and schema normalization. |
| Facebook OAuth stores page token and links Instagram | **Verified but not fully hardened** | Facebook callback stores page token at lines 488-504 and Instagram `igUserId` at lines 506-514. | Keep. Add state hardening and schema normalization. |
| `onJobFailed` sends failure email | **Verified** | `onJobFailed` starts at `functions/index.js` line 568 and sends email after failed transition. | Keep. It will only matter after jobs can fail through a processor. |
| `onUserCreated` sends welcome email | **Verified** | `onUserCreated` starts at `functions/index.js` line 612. | Keep. |
| `deleteAccount` is token guarded | **Verified** | `deleteAccount` verifies `idToken` and uses decoded UID at lines 654-660. | Use as model for other functions. |
| `createPortalSession` is correct | **Partially verified** | It reads `subscriptions/{uid}` at lines 298-304, but `uid` is supplied by body and not token-derived. | Must add token verification. |
| Firestore rules are owner-only | **Verified** | `firestore.rules` owner checks across `businesses`, `listingDrafts`, `publishJobs`, `platformConnections`, `activityLogs`. | Correct, but admin browser pages conflict with these rules. |
| Admin Queue / Logs are live, not static | **Partially verified** | They use live Firestore queries, but global reads conflict with owner-only rules. | Move admin reads behind backend endpoints or custom claims. |

---

## 4. P0 beta blockers - fix before any outside user tests paid auto-posting

# P0-1 - Missing publish job processor

## Status

**Verified. This is the biggest commercial blocker.**

## Evidence

File: `functions/index.js`

```javascript
// approveDraft reads request body
const { draftId, businessId, uid, platforms } = req.body; // line 158

// Creates publish jobs
const jobRef = db.collection('publishJobs').doc(); // line 172
status: isManual ? 'manual_required' : 'pending', // line 181
payload: { adaptedContent: platform.adaptedContent || '' }, // line 191
```

Auto-post functions exist:

```javascript
exports.postToGoogle = onRequest(async (req, res) => { ... }); // line 222
exports.postToFacebook = onRequest(async (req, res) => { ... }); // line 240
exports.postToInstagram = onRequest(async (req, res) => { ... }); // line 255
```

The only trigger on `publishJobs` is:

```javascript
exports.onJobFailed = onDocumentUpdated(...); // line 568
```

There is no `onDocumentCreated` worker for `publishJobs/{jobId}`.

## Why the existing handoff is right

The handoff correctly states that a job can be created with `status: 'pending'`, then sit forever unless something else processes it. That means the paid-user promise fails at the exact point where the user expects automation.

## Where the existing handoff needs improvement

The existing handoff suggests adding a single `onJobCreated` trigger and says this closes the loop. That is directionally correct but incomplete.

Problems with the proposed processor:

1. It duplicates Google/Facebook/Instagram API logic instead of sharing helpers.
2. It says failed jobs are “retrying soon,” but no retry scheduler exists.
3. It does not refresh Google tokens, even though Google OAuth stores `refreshToken`.
4. It handles Instagram image failure, but `approveDraft` only stores `adaptedContent`; it does not store `imageUrls` in job payload.
5. It has no dedupe/idempotency guard for avoiding duplicate posts if a function retries.
6. It does not solve the larger issue that publish jobs are also created directly from frontend code.

## Correct implementation direction

Create shared internal publishing helpers, then call them from the new trigger and any HTTP debug/admin functions.

Recommended helper structure:

```javascript
async function publishGoogleJob(job, conn) { ... }
async function publishFacebookJob(job, conn) { ... }
async function publishInstagramJob(job, conn) { ... }
async function markJobFailed(jobId, job, err, customerMessage) { ... }
async function markJobSuccess(jobId, platform, postId) { ... }
```

Then add:

```javascript
exports.onJobCreated = onDocumentCreated(
  { document: 'publishJobs/{jobId}', region: 'us-central1' },
  async (event) => {
    const job = event.data.data();
    const jobId = event.params.jobId;
    if (!job || job.status !== 'pending') return;
    if (!job.platform || !job.businessId || !job.uid) return;

    await db.collection('publishJobs').doc(jobId).update({
      status: 'processing',
      processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Load platformConnections/{businessId}_{platform}
    // Dispatch to helper
    // On success -> status success
    // On failure -> status failed
  }
);
```

## Verification steps

1. Create or select BlastyBiz as a Pro/Agency business.
2. Connect Google and Facebook using the real OAuth paths.
3. Create a listing and approve Google/Facebook platforms.
4. Watch Firestore `publishJobs`.
5. Confirm job state moves from `pending` to `processing` to either `success` or `failed`.
6. If failed, confirm `adminError`, `customerVisibleMessage`, and `updatedAt` are populated.
7. Confirm `onJobFailed` emails only on true failed transitions.

---

# P0-2 - User-level Cloud Functions trust client-supplied UID values

## Status

**New finding. This is a beta security blocker.**

## Evidence

Multiple HTTP functions accept `uid` or ownership identifiers directly from `req.body` without Firebase ID token verification.

File: `functions/index.js`

```javascript
// adaptListing - no auth, no uid verification, calls Anthropic
const { listing, platforms, tone, platformCats } = req.body; // line 82

// resolveCategories - no auth, no uid verification, calls Anthropic
const { description, platformCatLists } = req.body; // line 132

// approveDraft - trusts draftId, businessId, uid, platforms from body
const { draftId, businessId, uid, platforms } = req.body; // line 158
const userSnap = await db.collection('users').doc(uid).get(); // line 161

// uploadImage - trusts uid from body and writes to that user's path
const { uid, imageData, fileName, mimeType } = req.body; // line 210
const file = bucket.file(`users/${uid}/images/${Date.now()}_${fileName}`); // line 212

// createCheckoutSession - trusts uid/email from body
const { plan, uid, email } = req.body; // line 275
metadata: { uid } // line 286

// createPortalSession - trusts uid from body
const { uid } = req.body; // line 298
const subSnap = await db.collection('subscriptions').doc(uid).get(); // line 300
```

The code already contains one good model:

```javascript
// deleteAccount verifies idToken and derives uid from decoded token
const decoded = await admin.auth().verifyIdToken(idToken); // line 659
uid = decoded.uid; // line 660
```

## Why this matters

In production, the browser cannot be trusted to tell the backend which UID, draft, business, subscription, or storage path it owns. A user can modify request bodies.

Risk examples:

- User A could attempt to approve User B's draft if they obtain an ID.
- User A could upload files under another user's UID path.
- A billing portal session could be requested for another UID if known.
- Unlimited AI calls can be made without plan enforcement.

## Required fix

Add shared helper:

```javascript
async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) throw new Error('Missing Authorization Bearer token');
  return await admin.auth().verifyIdToken(token);
}
```

Then update user functions:

- `adaptListing`
- `resolveCategories`
- `approveDraft`
- `uploadImage`
- `createCheckoutSession`
- `createPortalSession`

Pattern:

```javascript
const decoded = await verifyBearer(req);
const uid = decoded.uid;
```

Then verify document ownership server-side:

```javascript
const draftSnap = await db.collection('listingDrafts').doc(draftId).get();
if (!draftSnap.exists || draftSnap.data().uid !== uid) {
  res.status(403).json({ error: 'Forbidden' });
  return;
}
```

## Verification steps

1. Call each function with no Authorization header: expect 401.
2. Call each function with invalid token: expect 401.
3. Call each function with valid token but another user's `uid` in body: backend ignores body UID and uses decoded UID.
4. Attempt to approve a draft not owned by user: expect 403.

---

# P0-3 - Admin pages conflict with owner-only Firestore rules

## Status

**New/refined finding. This is bigger than the original handoff stated.**

## Evidence

Firestore rules are owner-only:

File: `firestore.rules`

```javascript
// businesses: read only when request.auth.uid == resource.data.uid
match /businesses/{businessId} { ... } // lines 11-16

// publishJobs: owner-only
match /publishJobs/{jobId} { ... } // lines 27-32

// platformConnections: owner-only
match /platformConnections/{connId} { ... } // lines 35-40

// activityLogs: owner read only, no client write
match /activityLogs/{logId} { ... } // lines 49-52
```

But admin browser pages query global collections directly:

```javascript
// BlastyBiz-Admin-Failed-Jobs.html
query(collection(db, 'publishJobs'), where('status', 'in', statuses), orderBy('updatedAt', 'desc'), limit(50)); // line 31

// BlastyBiz-Admin-Queue-Manager.html
query(collection(db, 'publishJobs'), orderBy('updatedAt', 'desc'), limit(50));

// BlastyBiz-Admin-Platform-Health.html
query(collection(db, 'platformConnections')); // line 26

// BlastyBiz-Admin-Users.html
query(collection(db, 'businesses'), orderBy('businessName'), limit(100)); // line 29

// BlastyBiz-Admin-Logs.html
query(collection(db, 'activityLogs'), orderBy('createdAt', 'desc'), limit(50)); // line 156
```

## Why the original handoff was incomplete

The original handoff says admin pages are static or partially static. That is true, but not the deepest issue. The deeper issue is this:

> Even admin pages that use live Firestore queries may fail under the actual rules because the browser is not allowed to read everybody's records.

## Required fix

Do not make broad public Firestore rules just to satisfy admin pages.

Preferred beta approach:

1. Keep owner-only Firestore client rules.
2. Add backend admin endpoints in Cloud Functions.
3. Verify Firebase ID token.
4. Check admin authority.
5. Return sanitized data to admin pages.

There is already an admin-like pattern in `setOperatorSecret`:

```javascript
const decoded = await admin.auth().verifyIdToken(idToken); // lines 704-710
if (decoded.email !== 'perceys@gmail.com') { ... } // line 712
```

For beta, reuse that pattern. Later, replace hardcoded email with a custom claim or `admins/{uid}` backend-only check.

Required backend endpoints:

- `adminListPublishJobs`
- `adminListFailedJobs`
- `adminRetryJob`
- `adminMarkManualFollowup`
- `adminListBusinesses`
- `adminListPlatformConnections`
- `adminListActivityLogs`
- `adminSubscriptionSummary`

## Verification steps

1. Log in as non-admin and try admin endpoint: expect 403.
2. Log in as admin and call endpoint: expect data.
3. Confirm browser admin pages no longer query global Firestore directly.
4. Confirm Firestore rules remain owner-only.

---

# P0-4 - Publish job creation is not canonical

## Status

**New finding. This must be fixed before beta if publish status is supposed to be reliable.**

## Evidence

There are multiple code paths creating or touching `publishJobs`.

### Backend path

File: `functions/index.js`

```javascript
exports.approveDraft = onRequest(...); // line 154
const jobRef = db.collection('publishJobs').doc(); // line 172
batch.set(jobRef, { ... status: isManual ? 'manual_required' : 'pending' ... }); // lines 176-195
```

### Listing Preview frontend path

File: `BlastyBiz-Listing-Preview.html`

```javascript
window._firestoreApprove = async function(platformKeys) { ... } // line 269
await updateDoc(doc(db, 'listingDrafts', draftId), { status:'approved' ... }); // lines 291-294
await setDoc(jobRef, { ... }); // lines 296-324
```

### Main BlastyBiz form/history path

File: `BlastyBiz.html`

```javascript
await addDoc(collection(db, 'publishJobs'), { ... status: 'done' ... }); // around lines 1563-1569
```

## Why this matters

A production system needs one canonical definition of a publish job. Multiple writers create risks:

- inconsistent status names (`pending`, `manual_required`, `success`, `done`)
- inconsistent payload shape
- duplicate jobs
- bypassed plan gating
- bypassed backend validation
- confusing Publishing Status UI

## Required fix

Make backend `approveDraft` the only production writer for real publish jobs.

Frontend should call `approveDraft` with selected platform data and a Firebase ID token. Frontend should not write production `publishJobs` directly.

If UI history is needed, store it in a separate collection, for example:

- `activityLogs`
- `listingEvents`
- `uiHistory`

Do not use `publishJobs` for UI history entries with `status: 'done'`.

## Verification steps

1. Search public HTML for `collection(db, 'publishJobs')` and `addDoc(collection(db, 'publishJobs')`.
2. Only admin status pages should read jobs.
3. Only backend functions should create production jobs.
4. Confirm no new job uses `status: 'done'` unless status renderer intentionally supports it.

---

# P0-5 - Publishing Status mock data must be replaced, and the original fix must be corrected

## Status

**Verified finding; original fix does not match actual page.**

## Evidence

File: `BlastyBiz-Publishing-Status.html`

```javascript
function showMockData() { // line 319
  renderJobs([
    { jobId:'1', platform:'google', status:'success', ... }, // line 321
    { jobId:'2', platform:'facebook', status:'success', ... }, // line 322
    { jobId:'3', platform:'yelp', status:'success', ... }, // line 323
    { jobId:'4', platform:'bing', status:'success', ... }, // line 324
    { jobId:'5', platform:'applemaps', status:'success', ... }, // line 325
  ]);
}
```

It is called when there are no jobs or when loading fails:

```javascript
if (jobs.length) renderJobs(jobs); else window.showMockData(); // line 369
window.showMockData(); // line 376
```

## Why the existing handoff's fix is wrong

The existing handoff says to update `jobs-container`, but this page does not have a `jobs-container` element. The actual elements are:

- `loading-state`
- `content-state`
- `progress-count`
- `progress-bar`
- `platform-list`
- `action-card`
- `action-items`

## Required fix

Replace `showMockData()` with a real empty-state renderer using existing DOM IDs.

Correct direction:

```javascript
function showEmptyState(message = 'Your publishing jobs will appear here after you approve a listing.') {
  document.getElementById('loading-state').style.display = 'none';
  document.getElementById('content-state').style.display = 'block';
  document.getElementById('progress-count').textContent = '0 of 0';
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('platform-list').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">📋</div>
      <h3>No publishing jobs yet</h3>
      <p>${message}</p>
      <a class="btn-primary" href="BlastyBiz.html">Create Your First Listing</a>
    </div>`;
  document.getElementById('action-card').style.display = 'none';
  document.getElementById('action-items').innerHTML = '';
}
```

Then replace calls:

```javascript
if (jobs.length) renderJobs(jobs); else showEmptyState();
```

On error, show an error state, not fake success:

```javascript
showEmptyState('We could not load your publishing jobs. Refresh or contact support if this continues.');
```

## Verification steps

1. New user with no jobs sees no fake platforms.
2. User with failed network query sees error/empty state, not success rows.
3. User with real jobs sees actual jobs.

---

# P0-6 - Dashboard mock business fallback must be removed safely

## Status

**Verified finding; original fix is incomplete.**

## Evidence

File: `BlastyBiz-Dashboard.html`

```javascript
// Prototype mock data - replace with Firestore query // line 318
const BUSINESSES = [ ... QR Gear, Kingdom Connects, Pollsit, AfterSignal ... ];
```

Firestore query exists:

```javascript
const q = query(collection(db, 'businesses'), where('uid', '==', user.uid)); // line 510
```

But fallback loads prototype data:

```javascript
window.BUSINESSES = BUSINESSES; // line 527
window.activeBizId = userData.activeBusiness || BUSINESSES[0].id; // line 528
```

Error fallback also loads prototype data:

```javascript
window.BUSINESSES = BUSINESSES; // line 531
window.activeBizId = BUSINESSES[0].id; // line 532
```

## Why the existing handoff's fix is incomplete

It suggests setting `window.BUSINESSES = []` and `window.activeBizId = null`, but other dashboard functions assume a non-empty business array.

Examples:

```javascript
let activeBizId = BUSINESSES[0].id; // line 332
let active = BUSINESSES.find(b=>b.id===activeBizId) || BUSINESSES[0]; // around line 350
```

## Required fix

Add a first-class empty dashboard state.

Implementation direction:

1. Remove fallback to prototype businesses.
2. If no Firestore businesses exist, render an empty-state dashboard.
3. Hide or disable business switcher controls.
4. Provide CTA to onboarding.
5. Ensure `loadBusinessContext`, `renderSwitcher`, and any metric cards handle `BUSINESSES.length === 0`.

Pseudo:

```javascript
function hasBusinesses() {
  return Array.isArray(window.BUSINESSES) && window.BUSINESSES.length > 0;
}

function renderNoBusinessState() {
  // update active-name, active-plan, cards, and tasks
  // do not call loadBusinessContext with BUSINESSES[0]
}
```

## Verification steps

1. Create new account with no businesses.
2. Open Dashboard.
3. Confirm no QR Gear/Kingdom Connects/Pollsit/AfterSignal appear.
4. Confirm no JS errors in console.
5. Confirm CTA routes to onboarding.

---

# P0-7 - Failed Jobs bulk actions are unwired, and the original fix does not match actual row markup

## Status

**Verified finding; original implementation instructions are wrong.**

## Evidence

File: `BlastyBiz-Admin-Failed-Jobs.html`

Top buttons have no handlers:

```html
<button class="btn btn-primary">Retry Selected</button>
<button class="btn">Mark Manual Follow-up</button>
<button class="btn">Export Errors</button>
```

Dynamic rows are created without checkboxes or `data-job-id` attributes:

```javascript
tbody.innerHTML = jobs.map(j => `
  <tr>
    <td>${j.businessName || j.uid || 'Unknown'}</td>
    ...
    <td><button class="btn" onclick="jobAction('${j.jobId || j.id}','retry')">Retry</button></td>
  </tr>`).join('');
```

## Why the original fix is wrong

The existing handoff suggests selecting:

```javascript
.document.querySelectorAll('.job-checkbox:checked')
.document.querySelectorAll('tr[data-job-id]')
```

Those elements do not exist in the actual file.

## Required fix

Because admin pages must move behind admin backend endpoints anyway, bulk actions should not directly write Firestore from the browser.

Correct direction:

1. Add a checkbox column to failed-job rows.
2. Add `data-job-id`, `data-platform`, `data-status`, `data-error`, `data-created` attributes if CSV export remains client-side.
3. Replace direct `updateDoc` with admin backend calls:
   - `adminRetryJobs`
   - `adminMarkManualFollowup`
   - `adminExportFailedJobs`
4. Verify admin token server-side.

## Verification steps

1. Select multiple jobs.
2. Retry selected.
3. Confirm each job changes to `pending` or `processing` through backend.
4. Export errors returns real CSV of loaded failed jobs.
5. Non-admin cannot use these actions.

---

# P0-8 - AI usage limit and cost protection are missing

## Status

**Verified finding; original suggested fix must be secured.**

## Evidence

File: `functions/index.js`

`adaptListing`:

```javascript
exports.adaptListing = onRequest({ secrets: ['ANTHROPIC_API_KEY'] }, async (req, res) => { // line 78
const { listing, platforms, tone, platformCats } = req.body; // line 82
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }); // line 83
const response = await client.messages.create({ ... }); // lines 114-118
```

No auth check, no plan check, no per-month counter.

## Why the original handoff is partially right

It correctly identifies the missing cap. But its proposed fix accepts `uid` in the request body, which repeats the same security flaw.

## Required fix

1. Require Firebase ID token.
2. Derive UID from token.
3. Load `users/{uid}`.
4. Check `plan`.
5. Enforce plan limits.
6. Track attempts, successes, and failures separately.
7. Reset limits on subscription renewal or monthly schedule.

Suggested beta fields:

```javascript
users/{uid}: {
  plan: 'starter' | 'pro' | 'agency',
  aiActionsUsed: number,
  aiActionsLimit: number,
  aiUsageResetAt: timestamp
}
```

Suggested beta limits:

- starter: 10/month
- pro: 100/month
- agency: 500/month

## Verification steps

1. Unauthenticated `adaptListing`: expect 401.
2. Starter with `aiActionsUsed` at cap: expect 429.
3. Pro under cap: expect success and increment.
4. Failed Anthropic call should not incorrectly consume success quota unless attempts are intentionally billed.

---

## 5. P1 - important before paid beta but not necessarily before internal dogfooding

# P1-1 - Platform connection schema is inconsistent between backend OAuth and frontend UI

## Status

**New finding.**

## Evidence

OAuth callbacks write `platform`:

```javascript
// Google callback
businessId, uid, platform: 'google', status: 'connected' // functions/index.js line 417

// Facebook callback
businessId, uid, platform: 'facebook', status: 'connected' // line 500

// Instagram linked doc
businessId, uid, platform: 'instagram', status: 'connected' // line 509
```

Frontend platform save/read logic in `BlastyBiz.html` uses `platformId`:

```javascript
connMap[d.data().platformId] = d.data(); // BlastyBiz.html line 1464
platformId: p.id // BlastyBiz.html line 1546
```

Some pages handle both:

```javascript
const platformConns = conns.filter(c => c.platform === p.id || c.platformId === p.id); // Platform Health line 42
```

But not all code does.

## Risk

OAuth-created connections may be stored correctly but not recognized by UI code that expects `platformId`. This can cause false disconnected states.

## Required fix

Normalize every platform connection doc to contain both fields during beta:

```javascript
{
  uid,
  businessId,
  platform: 'google',
  platformId: 'google',
  status: 'connected',
  enabled: true,
  accessToken,
  refreshToken,
  accountId,
  locationId,
  updatedAt
}
```

Update:

- Google callback
- Facebook callback
- Instagram auto-link
- manual/frontend save path
- disconnect logic
- job processor lookup

## Verification steps

1. Connect Google.
2. Confirm `platformConnections/{businessId}_google` includes both `platform` and `platformId`.
3. Reload Connect, Dashboard, Platform Health, Listing form.
4. Confirm all read it as connected.

---

# P1-2 - OAuth state is functional but not hardened

## Status

**New finding.**

## Evidence

File: `functions/index.js`

Google initiation:

```javascript
const { businessId, uid } = req.query; // line 358
const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '' })); // line 364
```

Facebook initiation:

```javascript
const { businessId, uid } = req.query; // line 441
const state = encodeURIComponent(JSON.stringify({ businessId, uid: uid || '' })); // line 447
```

Callbacks trust decoded state:

```javascript
let businessId = '', uid = '';
try { const s = JSON.parse(decodeURIComponent(state)); businessId = s.businessId; uid = s.uid; } ... // Google lines 385-386, Facebook lines 467-468
```

## Risk

The OAuth flow works functionally, but the state is not cryptographically bound to a verified authenticated user/session. A hardened production OAuth flow should prevent tampering/replay and validate business ownership before storing tokens.

## Required fix

For beta:

1. Add signed state or nonce stored server-side.
2. Include `businessId`, `uid`, and expiration.
3. On callback, verify signature/nonce.
4. Confirm `businesses/{businessId}.uid === uid` before writing platform tokens.

## Verification steps

1. Tamper with state businessId: callback rejects.
2. Tamper with UID: callback rejects.
3. Use expired state: callback rejects.
4. Valid owner state: callback stores connection.

---

# P1-3 - Platform post functions lack structured error handling and token refresh

## Status

**New finding.**

## Evidence

File: `functions/index.js`

`postToGoogle`, `postToFacebook`, and `postToInstagram` call remote APIs directly and return success. There is no try/catch inside these function bodies.

```javascript
const response = await axios.post(...); // Google lines 225-232
res.json({ success: true, postId: response.data.name }); // line 233
```

```javascript
const response = await axios.post(...); // Facebook lines 243-246
res.json({ success: true, postId: response.data.id }); // line 247
```

```javascript
const media = await axios.post(...); // Instagram lines 258-261
const publish = await axios.post(...); // lines 262-265
res.json({ success: true, postId: publish.data.id }); // line 266
```

Google OAuth stores a refresh token:

```javascript
refreshToken: tokenData.refresh_token || '' // line 419
```

But post logic does not refresh expired access tokens.

## Required fix

Move posting into internal helpers used by the job processor. Each helper should:

- catch API errors
- translate provider error into `adminError`
- produce safe `customerVisibleMessage`
- set reconnect-required when token expired
- refresh Google token when possible
- fail Instagram cleanly if no image exists

## Verification steps

1. Force expired Google access token with valid refresh token: expect refresh and retry.
2. Force invalid Facebook page token: job becomes failed/reconnect-required.
3. Run Instagram job with no image: job becomes manual/action-needed, not crashed function.

---

# P1-4 - Stripe billing functions exist but user identity must be hardened

## Status

**Partially verified.**

## Evidence

Checkout session creation:

```javascript
const { plan, uid, email } = req.body; // functions/index.js line 275
metadata: { uid } // line 286
```

Portal session creation:

```javascript
const { uid } = req.body; // line 298
const subSnap = await db.collection('subscriptions').doc(uid).get(); // line 300
```

Webhook updates plan:

```javascript
const uid = sub.metadata.uid; // line 324
await db.collection('users').doc(uid).set({ plan, planActive: true }, { merge: true }); // lines 327-329
```

## What's right

Stripe checkout, portal, and webhook functions exist. The webhook updates Firestore plan/subscription records.

## What needs correction

Checkout and portal should not trust body-supplied UID or email. They should derive UID/email from verified Firebase token.

## Required fix

- `createCheckoutSession`: verify ID token, derive UID/email, validate requested plan.
- `createPortalSession`: verify ID token, load `subscriptions/{decoded.uid}` only.
- `stripeWebhook`: acceptable to use metadata UID because it is set server-side during checkout, but only after checkout UID is secured.

---

# P1-5 - Manual platforms are correctly treated as assisted, not automatic

## Status

**Verified positive finding.**

## Evidence

Backend functions mark Bing and Apple Maps as manual-required:

```javascript
exports.postToBing = onRequest(async (req, res) => { ... status: 'manual_required' ... }); // lines 528-540
exports.postToAppleMaps = onRequest(async (req, res) => { ... status: 'manual_required' ... }); // lines 548-560
```

The internal audit also notes manual-platform copy was reframed as platform limitation, not BlastyBiz limitation.

## Requirement

Do not market Bing or Apple Maps as full auto-post until a real API implementation exists. Market them as copy-ready/manual-assisted.

Recommended customer language:

> Auto-post where supported. Copy-ready guided publishing where platforms block third-party posting.

---

## 6. P2 cleanup and commercial polish

# P2-1 - Admin subscription and user screens contain static values

## Status

**Verified.**

## Evidence

File: `BlastyBiz-Admin-Subscriptions.html`

```html
$1,842 MRR, $126 AI Spend, 86% Gross Margin, 12 Trials Ending // line 8
```

File: `BlastyBiz-Admin-Users.html`

Static counts and example businesses are present near the top of the file. It later queries `businesses`, but the global query conflicts with rules.

## Required fix

For beta, either:

- replace static values with backend admin endpoint data, or
- add visible placeholder warning and hide static tables from operational use.

---

# P2-2 - Dashboard static metrics should not be confused with live analytics

## Status

**Verified from internal audit and Dashboard mock code.**

Known placeholders in `download/BlastyBiz_Audit.md` include:

- Dashboard business switcher list
- Blast Score `83%`
- task list
- Publishing Status mock fallback
- Platform Health static data
- Admin Subscriptions static data

## Required fix

Keep placeholders only if clearly labeled as demo data. For beta, customer-facing fake performance metrics should be removed.

---

# P2-3 - Operator secret management is useful for Dave but should mature later

## Status

**Verified.**

## Evidence

`setOperatorSecret` verifies token and hardcodes admin email:

```javascript
const decoded = await admin.auth().verifyIdToken(idToken); // around lines 704-710
if (decoded.email !== 'perceys@gmail.com') { ... } // line 712
```

## Direction

For Dave-only beta, this is acceptable. For broader production, replace hardcoded email with:

- Firebase custom claim `admin: true`, or
- backend-only `admins/{uid}` record.

---

## 7. Items from the existing handoff that should be kept

Keep these findings because they are backed by code:

1. Missing job processor is the primary blocker.
2. Publishing Status fake success data must be removed.
3. Dashboard mock business fallback must be removed.
4. Admin Subscriptions static numbers must be labeled or replaced.
5. Failed Jobs bulk buttons are unwired.
6. AI usage cap is missing.
7. Auth guard uses `authStateReady()` and appears intentional for mobile/OAuth race handling.
8. Google OAuth stores token/account/location details.
9. Facebook OAuth stores page token and auto-links Instagram where available.
10. `onJobFailed` sends failure email once jobs can actually fail through processing.
11. `onUserCreated` sends welcome email.
12. Firestore rules are owner-only and should not be casually loosened.
13. Operator secrets must be real before publishing can work.
14. Firebase Storage and Resend domain verification are operational prerequisites.

---

## 8. Items from the existing handoff that must be corrected before implementation

1. **Do not add the original job processor exactly as written.** Use helper functions, token refresh, retry semantics, dedupe, and canonical job creation.
2. **Do not leave `approveDraft` unchanged.** It trusts `uid`, `draftId`, and `businessId` from the request body.
3. **Do not use the original Publishing Status empty-state snippet.** It references a non-existent `jobs-container` element.
4. **Do not use the original Failed Jobs bulk-action snippet as-is.** The page lacks `.job-checkbox` and `tr[data-job-id]`.
5. **Do not implement AI usage cap using body-supplied `uid`.** Use verified Firebase token.
6. **Do not call Admin Queue/Logs “correct” simply because they use live Firestore.** They still conflict with owner-only rules for global admin reads.
7. **Do not rely on setting `BUSINESSES = []` alone in Dashboard.** Downstream code assumes `BUSINESSES[0]` exists.

---

## 9. Corrected implementation roadmap

## Step 1 - Add shared backend auth helpers

Add to `functions/index.js`:

```javascript
async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) {
    const err = new Error('Missing Authorization Bearer token');
    err.status = 401;
    throw err;
  }
  return await admin.auth().verifyIdToken(token);
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  if (decoded.email !== 'perceys@gmail.com') {
    const err = new Error('Forbidden');
    err.status = 403;
    throw err;
  }
  return decoded;
}
```

Then update all relevant user/admin functions.

## Step 2 - Harden user-level functions

Update:

- `adaptListing`
- `resolveCategories`
- `approveDraft`
- `uploadImage`
- `createCheckoutSession`
- `createPortalSession`

Each should derive `uid` from verified token, not body.

## Step 3 - Canonicalize publish-job creation

Make backend `approveDraft` the only production creator of `publishJobs`.

Remove/replace direct frontend job creation in:

- `BlastyBiz-Listing-Preview.html`
- `BlastyBiz.html`

## Step 4 - Add robust job processor

Add `onJobCreated` for `publishJobs/{jobId}` with:

- status transition `pending -> processing -> success/failed`
- platform connection lookup
- token refresh where possible
- retry semantics
- safe customer messages
- admin error detail
- idempotency/dedupe guard

## Step 5 - Normalize platform connection documents

Every connection record should contain both:

```javascript
platform: 'google',
platformId: 'google'
```

and consistent:

```javascript
uid, businessId, status, enabled, updatedAt
```

## Step 6 - Move admin global reads behind backend endpoints

Replace direct browser global queries with admin Cloud Functions.

Keep Firestore rules owner-only.

## Step 7 - Remove fake customer-facing data

Fix:

- `BlastyBiz-Publishing-Status.html` mock success jobs
- `BlastyBiz-Dashboard.html` mock business fallback
- dashboard static metrics if visible to customers

## Step 8 - Wire Failed Jobs bulk actions through backend

Add backend admin actions:

- retry selected jobs
- mark manual follow-up
- export errors

## Step 9 - Add AI usage caps

Add secure plan-based AI limits using verified UID.

## Step 10 - Use BlastyBiz as first beta customer

Create a real BlastyBiz business record, connect real platforms, run the complete flow, and build proof from real Firestore data.

---

## 10. BlastyBiz as the first live subject

This is the right commercialization test. Do not chase ten businesses first. Use BlastyBiz to market BlastyBiz.

## Required internal beta scenario

1. Dave logs in.
2. BlastyBiz business record exists in `businesses`.
3. BlastyBiz plan is Pro/Agency for testing.
4. Google is connected.
5. Facebook is connected.
6. Instagram is linked only if image flow is ready.
7. Create listing for BlastyBiz.
8. AI adapts content.
9. Categories resolve.
10. Approve listing.
11. Backend creates jobs.
12. Job processor posts or fails cleanly.
13. Publishing Status shows real state only.
14. Admin queue sees real state through backend admin endpoint.
15. Failed jobs can be retried.
16. Results feed a case-study page.

## Minimum case-study page

Create `BlastyBiz-Case-Study.html` only after real data exists.

Do not fake this page. Pull from Firestore/backend:

- platforms connected
- jobs created
- jobs successful
- jobs failed
- manual-assisted platforms completed
- last published date
- current action items

---

## 11. Final beta launch checklist

Do not invite outside beta users until these pass.

| Check | Required result |
|---|---|
| Function auth | User-level functions reject unauthenticated calls. |
| UID trust | Backend derives UID from token, not body. |
| Draft ownership | User cannot approve a draft they do not own. |
| Job creation | Only backend creates production publish jobs. |
| Job processor | Pending jobs move to processing then success/failed. |
| Publishing Status | No fake success data. |
| Dashboard | No prototype businesses for real users. |
| Admin access | Admin pages use verified backend endpoints. |
| AI cap | Starter/Pro/Agency limits enforced. |
| OAuth | Connections store normalized `platform` and `platformId`. |
| Error handling | Platform failures write `adminError` and customer-safe message. |
| Stripe | Checkout/portal derive UID from token. |
| Resend | Domain and key verified. |
| Storage | Firebase Storage enabled. |
| BlastyBiz dogfood | BlastyBiz listing completes full flow with real statuses. |

---

## 12. Final verdict

The existing handoff is valuable because it found real issues. It should not be thrown away.

But it is not implementation-safe as written because several proposed fixes do not match the actual code, and it underweights security and admin architecture problems.

The corrected position is:

- BlastyBiz is close enough to beta that it is worth finishing.
- The product does not need a rewrite.
- The critical work is workflow closure, not feature expansion.
- The first test subject should be BlastyBiz itself.
- The P0 work is backend trust, canonical jobs, processor, admin backend access, and fake-data removal.

After those fixes, BlastyBiz can credibly enter beta as a real SaaS product with BlastyBiz as its own proof engine.

