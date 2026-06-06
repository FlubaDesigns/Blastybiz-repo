---
name: BlastyBiz API wiring
description: How BlastyBiz Express routes and Firestore client-side writes are wired.
---

## Express routes at /api/
- `POST /api/adaptListing` — calls Anthropic, needs ANTHROPIC_API_KEY env secret
- `POST /api/resolveCategories` — calls Anthropic, needs ANTHROPIC_API_KEY env secret
- `POST /api/approveDraft` — Firebase Admin SDK (needs FIREBASE_SERVICE_ACCOUNT) — NOT USED in current flow

## Client-side approveDraft
approveDraft runs entirely client-side in BlastyBiz-Listing-Preview.html:
1. Creates/updates listingDrafts/{draftId} document with status: 'approved'
2. Creates publishJobs/{jobId} documents for each platform
3. Redirects to BlastyBiz-Publishing-Status.html?draftId=XXX

No server secret needed. Firestore rules allow authenticated users to write their own docs.

## User flow after adaptation
1. BlastyBiz.html → runAdaptation() → calls /api/adaptListing
2. Success → shows "Review & Approve All Listings" button
3. _afterAdaptation() saves draft to listingDrafts Firestore
4. Button href updated to BlastyBiz-Listing-Preview.html?draftId=XXX
5. Listing Preview → Approve & Continue → client-side creates publishJobs
6. Redirects to BlastyBiz-Publishing-Status.html?draftId=XXX
7. Publishing Status reads publishJobs from Firestore and renders status

**Why:** Moving approveDraft client-side avoids needing a Firebase service account in Replit secrets. The security model is enforced by Firestore rules (users can only write their own docs).
