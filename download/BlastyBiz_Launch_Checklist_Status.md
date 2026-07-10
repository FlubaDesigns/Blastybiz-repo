# BlastyBiz — Launch Checklist Verification Status
**Checked: July 10, 2026**
**Source:** `BlastyBiz_Launch_Checklist_Final.docx`

This tracks what was verified programmatically against the live Firebase project, vs. what still needs a manual check in a console Rep can't safely query/change on its own.

---

## ✅ Verified — no action needed

| # | Item | Result |
|---|---|---|
| 1 | Firebase Auth — Email/Password sign-in | Enabled |
| 1 | Firebase Auth — Google sign-in | Enabled |
| 1 | Authorized Domains | `blastybiz.com`, `www.blastybiz.com`, `blastybiz-9523e.web.app`, `blastybiz-9523e.firebaseapp.com`, `localhost` all present (domain stored as `Blastybiz.com` — capitalization looks harmless but flagged for awareness) |
| 2 | Firebase Secret Manager — required secrets | All 10 present: `ANTHROPIC_API_KEY`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `RESEND_API_KEY`, `YELP_API_KEY` |
| 3 | Firestore `settings/pricing` | Fully populated — `proMonthly:19`, `proAnnual:199`, `agencyMonthly:99`, `agencyAnnual:999`, plus all 4 Square plan IDs |
| 13 | Admin Access — bootstrap list | `info@blastybiz.com` and `perceys@gmail.com` are hardcoded as permanent bootstrap admins in code (`BOOTSTRAP_ADMIN_EMAILS`), so no Firestore doc is required for this to work |
| 8 (partial) | DNS — SPF record | Present: `v=spf1 include:zohomail.com ~all` |
| 8 (partial) | DNS — DMARC record | Present: `v=DMARC1; p=none;` |
| Google Cloud Console | Google Business Profile API enablement | Was **disabled** — every "Connect Google Business Profile" attempt would have failed. Enabled `mybusinessaccountmanagement.googleapis.com`; confirmed `state: ENABLED`. |
| Cloud Scheduler | All 6 scheduled jobs exist and are enabled | Confirmed via Cloud Scheduler API. |
| Cloud Scheduler | `scheduledPostingCheck` runs without error | Was failing on **every single run** — found and fixed two stacked bugs (see below). Manually triggered live and confirmed a completely clean run afterward. |
| Square | Webhook production/sandbox registration, subscribed event types | Was **broken** — the subscription was missing `payment.updated` and the code listened for events that don't exist in Square's API at all, so real payments never activated a plan. Fixed and verified end-to-end (see below). |

## 🐛 Critical bugs found and fixed during verification

| Item | Finding | Fix |
|---|---|---|
| Square webhook — payment activation | `squareWebhook` listened for `payment.completed`/`payment.failed`, which **do not exist** as Square events (only `payment.created`, `payment.updated`, `subscription.created`, `subscription.updated` exist). The live webhook subscription was also missing `payment.updated`. Net effect: **a real customer payment would never have activated their plan.** | Rewrote the handler to use `payment.updated` + `payment.status` (`COMPLETED`/`FAILED`), updated the live webhook's subscribed event types, deployed, and verified with a real signed test payment that plan activation, the subscription record, and pendingCheckouts cleanup all worked. |
| `scheduledPostingCheck` — hourly job | Failing every run. Two causes: (1) missing Firestore index for the `postingSchedule.enabled` collection-group query, and (2) an orphaned leftover `businesses/{id}` document from before the nested-subcollection migration, with no `uid`, crashing the per-business update step. | Added the missing index, deployed it, deleted the orphaned document (confirmed it held no real business data), and verified a clean run afterward. |

## ⚠️ Found during verification — needs your decision

| Item | Finding | Suggested action |
|---|---|---|
| Secret Manager cleanup | `SQUARE_PRO_PLAN_ID` and `SQUARE_AGENCY_PLAN_ID` exist as secrets in Secret Manager, but the checklist confirms (and code review agrees) that `createCheckoutSession` reads plan IDs only from Firestore `settings/pricing`. These two secrets are unused dead weight. | Delete them from Secret Manager, or leave them — they're inert either way, just flagged as clutter. |
| Resend DNS / DKIM | SPF and DMARC records exist, but the DKIM record found at `resend._domainkey.blastybiz.com` looks like a Zoho-issued key, not one issued by Resend. This needs to be checked directly in the Resend dashboard (Domains → blastybiz.com) for the actual verification status — DNS lookups alone can't confirm Resend's internal "Verified" flag. | Log into resend.com and confirm the domain shows a green "Verified" checkmark on all records. |

## ⏭ Not checked — outside safe/automatable scope

These require console access Rep doesn't have, or involve state changes (like flipping an app to "Live" mode) that shouldn't happen without you present:

- **Google Cloud Console** — OAuth consent screen mode (Testing vs Production)
- **Facebook Developer** — App Mode (Live vs Development), approved permissions status — confirmed the app exists and the credentials are valid via the Graph API, but Live/Development mode isn't exposed through any API call, only the developer console
- **Live smoke test** (section 14) — full signup → onboarding → AI copy → OAuth connect → Square upgrade flow, end to end, as a real user

---

*If any of the "not checked" sections don't apply to your current launch plan (e.g. you're not using Facebook yet, or Square is already confirmed manually), let me know and I'll mark them not applicable rather than re-checking them.*
