# Pass 06 review corrections

Applied to Pass 06 (4bbf0df), with Pass 07 kept separate for review.

- P6-1: reserve the campaign-chat allowance only when history contains exactly one user message, as requested. Keep existing 429/503 responses.
- P6-2: normalize missing and unknown platform types to manual; retain ID validation and duplicate suppression.
- P6-3: redirect missing Story user/business context to CreateBiz; retain retry for save failures.
- P6-4: use the existing friendly fallback for non-JSON approval/deletion errors.
- P6-5: restore the photo-delete live marker alongside Pass 06 markers.

The existing deployment workflow now includes approvePendingPost, chatCampaign and deleteBusiness.

Validation: 49 Pass 06 behavior assertions and 123 existing regression assertions pass (172 total). Release consistency checks pass with live endpoint probing skipped locally. Backend syntax and git whitespace checks pass. These tests use isolated services; no customer records or live posts were created.

The review's separate earlier-pass open items are not claimed resolved by these five corrections. Pending-post approval still has no producer in this repository. The requested history-based chat charging change is not a server-side conversation receipt: retrying a first message may charge again, and a supplied multi-message history skips reservation.
