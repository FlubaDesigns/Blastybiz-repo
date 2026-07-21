# BlastyBiz — To-Do List (Pass 4 Maintainability Items)

These are not bugs. They are engineering debt items to action when time allows.
None of them block shipping.

## HIGH — Admin step editor: full redesign (text + mood + animations, auto-save, Firebase as truth)
Complete overhaul of the OB1 step cards in BlastyBiz-Admin-OnboardSteps.html:
- **Single editable text field per step** — no separate "default" label + "override" input. One box. Auto-saves on change (debounce ~800ms). No Save or Clear buttons.
- **Firebase is the source of truth** — admin reads the current value from Firestore on load (config/ob1Steps). JS hardcoded text in OB1 page is a cold-start fallback only, never shown in admin.
- **Mood + animation controls per step** — every step card gets: Mood dropdown, Flame dropdown, Lights dropdown, Eyes dropdown, Smoke checkbox, Nose-spin checkbox. Same controls as OB2 event cards. All auto-save.
- **OB1 and OB2 share the same admin pattern** — same card design, same auto-save wiring, same Firebase structure.
- OB1 page (BlastyBiz-Onboard2.html) already reads anim overrides via _ob2ApplyOverrides — extend to also apply text overrides from Firebase at load.

## HIGH — Shared service modules
Do this alongside the BlastyBiz.html modularization (full-site handoff, Finding 17).
Create four thin service modules that every page imports:
- `aiAdaptationService` — wraps adaptListing / regeneration CF calls
- `publishingService` — wraps approveDraft CF + status polling
- `storageService` — photo/document upload (currently duplicated between wizard and Business Context)
- `notificationService` — toasts + email-trigger calls

Every page should call a service, never a raw fetch/Firestore call directly for these four concerns.

## MEDIUM — Naming convention document
Write a one-page doc covering:
- kebab-case for HTML IDs and CSS classes
- camelCase for functions and variables
- single leading-underscore for module-private state only
Apply going forward as files are touched — no big-bang rename sweep.

## LOW — Architecture & data model doc
Write after the canonical listingDraft schema is stable (Pass 2 Phase A is done).
Cover: listingDrafts, platformConnections, campaigns collections; allowed platform sub-states;
state-transition diagram from blast creation through publish.
