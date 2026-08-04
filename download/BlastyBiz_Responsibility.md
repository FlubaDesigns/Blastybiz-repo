# BlastyBiz — Client/Server Responsibility Matrix

*Created: 2026-08-03 (Production Pass 3)*

This document answers the recurring audit question "which layer is supposed to enforce this?" for every significant system boundary in BlastyBiz. Any future finding marked "backend-dependent, unverifiable" should be checked here first.

---

## How to read this table

| Column | Meaning |
|--------|---------|
| **Enforced by** | The authoritative layer that makes the final decision. If two layers both check, the server is authoritative; the client check is UX only. |
| **Client also checks?** | Whether the browser UI additionally validates before sending (performance/UX, not security). |
| **Where in code** | Canonical location of the server-side enforcement. |

---

## Authentication & Session

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| User is signed in | **Firebase Auth + auth-guard.js** | Yes — `auth-guard.js` redirects before page renders | `auth-guard.js`; Firebase SDK validates the ID token on every CF request via `verifyBearer()` |
| Session expiry | **Firebase Auth** (auto-refresh) | No explicit check needed | Firebase SDK handles token refresh automatically |
| Admin access | **Cloud Function** (`requireAdmin`) | Yes — `admin-guard.js` hides the page | `functions/index.js`: `requireAdmin(req)` verifies token + email against `config/admins` Firestore doc |
| Sign-out clears local cache | **Client** | Yes — `doSignOut()` removes `bb_profile`, `bb_platforms_enabled` | `BlastyBiz.html`: `window.doSignOut()` |

---

## Plan Limits & Business Counts

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| Max businesses per plan | **Client only** (Firestore `settings/bizLimits`) | Yes — Dashboard + Businesses.html read the Firestore limit doc | ⚠️ **No server-side enforcement exists.** Firestore security rules do not cap the number of business subcollection documents. A determined user could create extra businesses by bypassing the UI. Flagged in Pass 1. |
| Plan tier (starter/pro/agency) | **Cloud Function** (`adminSetPlan`) since Pass 2 | N/A — set by admin only | `functions/index.js`: `adminSetPlan` requires server-verified admin status |
| Plan-limit enforcement on create | **Client only** | Yes | ⚠️ Should be added as a Firestore rule or enforced in a `createBusiness` CF. Currently client reads `settings/bizLimits` and blocks the UI — no server check. |

---

## OAuth / Platform Connections

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| OAuth token exchange (Google) | **Cloud Function** | No | `functions/index.js`: `googleOAuthCallback` (~line 1620) |
| OAuth token exchange (Facebook) | **Cloud Function** | No | `functions/index.js`: `facebookOAuthCallback` (~line 1732) |
| Token storage | **Cloud Function** | No | Stored in `users/{uid}/businesses/{bizId}/platformConnections/{platform}` by the CF, never written by the client |
| Proactive token refresh | **Cloud Function** (scheduled) | No | `functions/index.js`: `checkPlatformTokenExpiry` (runs every 30 min) |
| Platform disconnection + token revocation | **Cloud Function** (`disconnectPlatform`) since Pass 3 | Yes — UI confirms before calling | `functions/index.js`: `disconnectPlatform` calls OAuth revocation endpoints then updates Firestore |

---

## Post Scheduling

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| Scheduled time is in the future | **Client** | Yes — `saveSchedule()` rejects past dates since Pass 3 | `BlastyBiz-Listing-Preview.html`: `saveSchedule()` |
| Scheduled time is within 1 year | **Client** | Yes — `saveSchedule()` rejects dates > 365 days out since Pass 3 | `BlastyBiz-Listing-Preview.html`: `saveSchedule()` |
| Timezone accuracy | **Client** (stores both `sendAtUtc` + `timezone`) | N/A | `BlastyBiz-Listing-Preview.html`: stores ISO 8601 UTC timestamp in `sendAtUtc`; backend **must use `sendAtUtc`**, never the bare `sendAt` local string |
| ⚠️ Backend scheduling execution | **Unknown — not yet verified** | N/A | No scheduled-post execution Cloud Function has been reviewed. When built, it must read `sendAtUtc`, not `sendAt`. |

---

## Publishing Queue

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| Publish job creation | **Client** writes to `publishJobs` subcollection | Yes — adaption must exist before publish | `BlastyBiz.html`: `approveDraft` CF in Pass 1 review |
| Job idempotency (no duplicate publishes) | **Cloud Function** | No | `functions/index.js`: `jobCompletedTrigger` / `jobFailedTrigger` — check job status before processing |
| Admin mutation of jobs (retry/cancel) | **Cloud Function** (`adminSetPlan`, Queue Manager ops) | Yes — admin page UI | `functions/index.js`: admin CFs require `requireAdmin()` |

---

## Data Security & Escaping

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| HTML escaping before innerHTML | **Client** | Yes — `escHtml()` / `_esc()` wraps all dynamic values | `escape-utils.js` (canonical); all 11 pages delegate to it as of Pass 2 |
| Firestore security rules | **Firestore rules** | N/A | `firestore.rules` — ownership enforced by path segment (`request.auth.uid == userId`) |
| Storage security rules | **Firebase Storage rules** | N/A | `storage.rules` |
| Photo file type validation | **Client** | Yes — `file.type.startsWith('image/')` since Pass 2 | `BlastyBiz.html`: `_bbUploadPhoto()` |

---

## Admin Operations

| Concern | Enforced by | Client also checks? | Where in code |
|---------|-------------|---------------------|---------------|
| Plan changes | **Cloud Function** (`adminSetPlan`) since Pass 2 | Yes — admin page only | `functions/index.js` |
| Business deletion | **Cloud Function** (`adminDeleteBusiness`) since Pass 2 | Yes — admin page only | `functions/index.js` |
| AI settings changes | **Cloud Function** (`adminSetAiSettings`) | Yes — admin page only | `functions/index.js` |
| Email sending (test/manual) | **Cloud Function** (`sendTestEmail`) | Yes — admin page only | `functions/index.js` |
| Yelp category cache refresh | **Cloud Function** (`refreshYelpCategories`) | Yes — admin page only | `functions/index.js` |

---

## Known gaps (open items)

| Gap | Severity | Notes |
|-----|----------|-------|
| Business count limit not enforced server-side | Medium | Client reads `settings/bizLimits` but no CF or Firestore rule prevents exceeding it |
| Post scheduling execution not reviewed | Unknown | No scheduled-post runner CF has been audited — **must use `sendAtUtc`** when built |
| Post scheduling not enforced server-side | Low | Client validates future date; no server-side duplicate check before the job is queued |
