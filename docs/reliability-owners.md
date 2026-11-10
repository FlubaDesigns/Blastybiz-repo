# BlastyBiz reliability owners

The existing Firestore records remain authoritative. Browser state is a view of those records, and generated browser platform definitions come from the server source.

| Concern | Source of truth | Consumers |
| --- | --- | --- |
| Platform defaults and override merging | `functions/lib/platforms.js`, `settings/platformDocs` | Initial copy, rewrites, scheduled refresh, admin editor, generated `public/platforms-authority.js` |
| Generation claim, result and allowance settlement | `functions/lib/ai-allowance.js`, existing `aiRequestDedup`, user allowance and private rewrite grant | `adaptListing`, scheduled copy refresh, abandoned-request recovery |
| Copy validation and bounded repair | `functions/lib/platform-copy.js` | Initial copy, rewrites, scheduled copy refresh |
| Browser retry identity | `public/ai-generation.js` | Initial generation and individual platform rewrites |
| Saved campaign and Ad | Existing campaign/Ad records and `ad-workspace.js` | Create, Review and existing scheduler |
| Published outcome | Existing frozen packet and `publishJobs` | Publisher, reconciliation, Results |
| Price and subscription | Existing pricing settings, subscription record, verified Square responses/events | Checkout, account controls, access changes |
| Presentation | `public/global-style.css` and canonical row/column helpers | Workspace and account |

The workspace markup loads `workspace-editor.js`, `workspace-data.js`, and `workspace-campaigns.js` in their original execution order. Regression fixtures assemble those same files through `scripts/lib/workspace-source.cjs`; they do not maintain a separate implementation.

Generation reserves once per authenticated request ID and input fingerprint. Usable output is saved before replying. Empty, malformed or overlong output gets at most one repair attempt; complete failure restores the reservation. Scheduled refresh requires every requested platform and otherwise preserves the approved copy. An expired claim can be recovered only through the same token-checked transaction. Other AI tools retain their existing per-action accounting.

Billing controls review current server pricing and subscription version. Only the user's stored Square subscription can be changed. An uncertain provider result blocks another mutation until status confirms the first result. Verified billing events continue to own access; clicking a button does not grant or revoke a plan.

Release checks include provider-free failure/concurrency tests, the established payment/security gate, browser checks, and Firestore authorization tests. Live acceptance uses isolated paused fixtures, cached generation results, and subscription status only. It never sends a real post, purchases AI output, or changes a real subscription.
