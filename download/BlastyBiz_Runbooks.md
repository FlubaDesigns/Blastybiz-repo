# BlastyBiz Operational Runbooks

Last updated: 2026-07-10

These are "break glass" procedures for handling emergencies in production.
All admin actions require being logged in as an admin at https://blastybiz-9523e.web.app

---

## 1. Disable a Bad Actor's Account

**When to use:** A user is abusing the platform, spamming, or you need to lock them out immediately.

**Steps:**
1. Log in as admin → go to **Admin → Users** (BlastyBiz-Admin-Users.html)
2. Find the user by email or name
3. Go to Firebase Console → Authentication → https://console.firebase.google.com/project/blastybiz-9523e/authentication/users
4. Search for their email → click the three-dot menu → **Disable account**
5. Their existing session tokens will stop working within 1 hour (Firebase token TTL)
6. To immediately revoke all sessions: Firebase Console → that user → **Revoke all sessions**

**To re-enable:** Same path → three-dot menu → **Enable account**

---

## 2. Retry a Stuck or Failed Posting Job

**When to use:** A customer's post failed to publish to Facebook, Instagram, or Google Business, and they need it retried.

**Steps:**
1. Log in as admin → go to **Admin → Failed Jobs** (BlastyBiz-Admin-Failed-Jobs.html)
2. Find the failed job — it shows the business name, platform, and error reason
3. Click **Retry** on the job — this calls the `adminRetryJob` Cloud Function which re-runs the publish attempt with a fresh token
4. If the retry fails again, check the **error reason**:
   - `"token expired"` → the customer needs to reconnect their platform account (see Runbook 4)
   - `"Instagram posts require an image"` → the job is marked `manual_required`, meaning it can't be auto-posted without an image; click **Mark Manual Followup** and email the customer
   - Any other error → check Cloud Logging (see Runbook 5)

---

## 3. Rotate a Secret / API Key

**When to use:** A secret key is compromised, or a provider forces a key rotation.

**Secrets currently in use (all stored in GCP Secret Manager):**
- `ANTHROPIC_API_KEY` — Claude AI
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Business OAuth
- `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` — Facebook/Instagram OAuth
- `RESEND_API_KEY` — Email sending
- `YELP_API_KEY` — Yelp category data

**Steps:**
1. Generate the new key from the provider's dashboard
2. Go to GCP Secret Manager → https://console.cloud.google.com/security/secret-manager?project=blastybiz-9523e
3. Click the secret name → **+ Add new version** → paste the new key → **Add version**
4. Then disable the old version (click the old version → **Disable**)
5. Redeploy Cloud Functions so they pick up the new secret version:
   - `npx firebase-tools deploy --only functions` from the Replit workspace
6. **Verify** by triggering the relevant feature (e.g. send a test email to confirm Resend key works)

**Note:** Never put secret values in code, `.env` files tracked by git, or chat messages.

---

## 4. Customer Can't Connect Facebook / Instagram / Google Business

**When to use:** A customer reports their platform shows "Reconnect required" or posts are failing with token errors.

**Steps:**
1. Log in as admin → **Admin → Platform Health** page or **Failed Jobs**
2. Confirm the connection shows `status: expired` for that business
3. The customer needs to re-connect themselves:
   - Direct them to log into BlastyBiz → Platforms page → click **Reconnect** next to the affected platform
4. If they're stuck in a loop (keep getting errors reconnecting):
   - Check that the platform app is still Live (Facebook) or the OAuth client is still active (Google)
   - Check Firebase Console → Functions logs for the specific OAuth callback error

**For mass token expiry** (e.g. Facebook rotated page tokens after a policy change):
- Run `adminSendReconnectNudge` from the Admin panel — sends all affected users a reconnect email automatically

---

## 5. Check Cloud Function Errors in Production

**When to use:** Something is broken but you're not sure which function or why.

**Steps:**
1. Go to GCP Cloud Logging → https://console.cloud.google.com/logs/query?project=blastybiz-9523e
2. Use this query to see all function errors from the last 24 hours:
   ```
   resource.type="cloud_run_revision"
   severity>=ERROR
   ```
3. Click any error to expand it — the `textPayload` or `jsonPayload` shows the function name and error message
4. To filter to a specific function (e.g. `adaptListing`):
   ```
   resource.type="cloud_run_revision"
   textPayload=~"adaptListing"
   severity>=ERROR
   ```

---

## 6. Send Recovery Emails to Past-Due Subscribers

**When to use:** You want to email all customers whose payment has lapsed asking them to update their billing.

**Steps:**
1. Log in as admin → go to **Admin → Subscriptions** (BlastyBiz-Admin-Subscriptions.html)
2. Click **Send Recovery Emails**
3. This calls the `adminSendRecoveryEmails` Cloud Function — it queries all businesses with `subscriptionStatus: past_due` and sends each owner a payment recovery email via Resend from `billing@blastybiz.com`
4. A confirmation toast shows how many emails were sent

---

## 7. Export Billing / Subscriber Data

**When to use:** You need a CSV of all subscribers and their plan/status for accounting, taxes, or a third party.

**Steps:**
1. Log in as admin → go to **Admin → Subscriptions**
2. Click **Export Billing CSV**
3. A CSV file downloads automatically to your device with: business name, owner email, plan, status, and trial end date

---

## 8. Add or Remove an Admin

**When to use:** You're adding a team member who needs admin access, or removing someone who's left.

**Steps:**
1. Log in as admin → go to **Admin → Users**
2. Use the **Manage Admins** section (calls `adminGetAdminEmails` / `adminUpdateAdminEmails`)
3. Add or remove the email address from the admin list
4. The change takes effect immediately — the next time that person loads an admin page their access is either granted or denied

**Note:** The bootstrap admin (info@blastybiz.com) cannot be removed through this UI — it's hardcoded as a fallback.

---

## 9. GCP Billing Alert — You Got a $200 Warning Email

**When to use:** Google sends an alert that you've hit 50%, 90%, or 100% of the $200 monthly budget.

**What it means:**
- **50% ($100)** — Normal if you have active users; keep an eye on it
- **90% ($180)** — Review Cloud Logging for any runaway function loops; check AI usage logs in Firestore (`aiUsageLogs` collection) for unusually high `costUsd` values
- **100% ($200)** — GCP does NOT automatically shut anything off — this is just a notification. Investigate immediately.

**How to investigate runaway costs:**
1. GCP Console → Billing → https://console.cloud.google.com/billing/01FBE7-D0C3BF-40FF56/reports → filter by service to see what's driving cost (usually Cloud Functions invocations or Anthropic API calls)
2. If AI costs are the driver: check `aiUsageLogs` in Firestore for a single UID with unusually high usage — that account may be abusing the platform; disable it (Runbook 1)
3. If Cloud Functions invocations are the driver: check Cloud Logging for a function being called in a loop (Runbook 5)
