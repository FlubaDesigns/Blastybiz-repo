# LinkedIn company Page connection

This adds company-only OAuth to the existing BlastyBiz nonce, cookie, browser
verifier and authenticated destination selection. It does not enable publishing.
LinkedIn remains manual in the canonical platform registry and delivery worker.
No personal-profile publishing permission is requested. Page selection accepts only
organization URNs with approved ADMINISTRATOR access, rechecked at confirmation.
Credentials are saved only in the existing server-only private token document.

## Activation prerequisites

- LinkedIn must grant the app Community Management API access. Company association
  verification and business email verification do not establish API approval.
- Configure LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET in BlastyBiz's existing
  Firebase Secret Manager OAuth path. Never put the secret into a chat, repository,
  browser storage, URL, or public Firestore document.
- In the app's Auth tab add this exact authorized redirect URL:
  https://us-central1-blastybiz-9523e.cloudfunctions.net/linkedinOAuthCallback
- Required granted scopes: r_organization_admin and w_organization_social.
  No w_member_social permission is requested.

The reported app's public client ID is 78nz74upx8k6uc. Its company association was
verified. Community Management submission/approval remains unconfirmed because
the access form reported completed or expired. Existing LinkedIn support case:
CAS-12178861-C7D8N6. An open support case is not an access approval.

## Release and acceptance

Release through the existing Fluba Authorization Engine only, after exact-source
release/security gates. Changed deployed Functions: initiateLinkedinOAuth,
linkedinOAuthCallback, oauthDestination and disconnectPlatform, plus Hosting.
The callback and initiation depend on the configured secrets; do not deploy an
unconfigured credential binding or label setup complete without checking it.

Local fixtures: node --test scripts/test-linkedin-connection.cjs and
node scripts/test-account-oauth-security.cjs. The LinkedIn tests run in check-release.
They exercise person/role rejection, revoked access, owner and verifier binding,
private-token separation, one-time transaction consumption, bounded pagination,
expired grants and page script syntax. They do not prove provider approval or a
live account connection. After activation, verify owner consent, company selection,
saved organization binding and local disconnect without creating a real post.

Access-token expiry requires reconnection; this change does not add silent refresh.
Disconnect deletes this business's local LinkedIn token and connection, leaving
other business connections intact. Provider-side app access can be removed in
LinkedIn's account settings by the member when desired.

Official API references:
https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09
https://learn.microsoft.com/en-us/linkedin/marketing/community-management-app-review?view=li-lms-2026-06
