# BlastyBiz — Pre-Launch Fix To-Do List
**Created: July 10, 2026, from final pre-launch code audit**

---

## 🔴 Fix before launch

- [ ] **1. Lock down Storage rule for business files**
  `storage.rules` — `businesses/{bizId}/**` currently allows read to *any signed-in user*, not just the owner. Any logged-in account can read another business's photos/documents.
  → Add an owner check (needs a `uid` on the object path or metadata check) so only the owning user (or admin) can read.

- [ ] **2. Align Storage path structure with Firestore**
  `storage.rules` uses a flat `businesses/{bizId}/**` path; Firestore uses nested `users/{uid}/businesses/{bizId}`. Update the Storage path (and any Cloud Function that writes to Storage) to include the `uid` segment, so rule #1's owner check has something to check against.

- [ ] **3. Restrict CORS to your real domains**
  `functions/index.js:171` — `Access-Control-Allow-Origin: '*'` on all HTTP functions.
  → Change to an allowlist of `https://blastybiz.com`, `https://www.blastybiz.com`, `https://blastybiz-9523e.web.app`.

---

## 🟡 Review, lower urgency

- [ ] **4. Tighten `approvePendingPost`**
  Confirm it verifies the caller owns the `bizId` passed in the request body, not just that they own the post itself.

- [ ] **5. Make `reserveAiAction` fail closed**
  Currently logs a warning and *proceeds* if the usage-limit transaction fails, instead of blocking the AI call. Should deny on transaction failure instead.

- [ ] **6. Add rate limiting to `createCheckoutSession` and `initiateGoogleOAuth`**
  Both require a valid auth token (so not wide open), but have no per-user/per-IP throttle. Add a simple rate limit like the one already used on the contact form.

- [ ] **7. Confirm the two different Firebase Web API keys are intentional**
  `BlastyBiz-Contact.html` uses one key; `firebase-init-v2.js` / `BlastyBiz-Admin-Operate.html` use another. Confirm both are meant to exist and are equally domain-restricted in the Cloud Console, or consolidate to one.

- [ ] **8. Escape Firestore-sourced strings before `innerHTML`**
  History notes, admin email rows, and a few other spots inject Firestore data into `innerHTML` without escaping. Low risk today, but should be hardened (use the existing `escHtml` helper consistently) before it becomes an XSS bug.

---

## Already confirmed solid — no action needed
- Square webhook signature verification
- Unsubscribe link signature verification
- Admin gating (`requireAdmin`/`isAdmin`) across sensitive functions and Firestore collections
- No secrets/tokens ever logged
- Contact form IP-based rate limiting
- AI usage quota + duplicate-request dedup
- No leftover TODO/FIXME markers in code
