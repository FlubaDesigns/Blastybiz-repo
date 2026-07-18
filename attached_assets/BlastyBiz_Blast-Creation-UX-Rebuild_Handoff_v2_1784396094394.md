BLASTYBIZ — BLAST CREATION UX REBUILD HANDOFF (v2)

PURPOSE

Rebuild the BlastyBiz blast-creation experience into a clean, mobile-first wizard without rewriting the working business logic underneath it.

The current Create flow is too dense for mobile use. It contains long scrolling sections, overloaded platform accordions, repeated decisions, platform setup mixed into every blast, and more than one approval surface.

The goal is to simplify the user-facing experience while preserving all existing generation, autosave, platform-state, category, draft, and publishing behavior.

---

PRIMARY UX DECISION

Proceed with the full wizard rebuild.

Use the proven wizard pattern already implemented in:

"BlastyBiz-Onboarding.html"

Reuse its existing concepts where practical:

- ".slide"
- ".wiz-header"
- ".progress-track"
- ".step-dots"
- Previous and Next navigation
- Swipe navigation
- Mobile-first single-screen decisions
- Resume-from-draft behavior

Do not create a second unrelated wizard framework unless the existing onboarding structure cannot safely support the Create flow.

---

CORE WORKFLOW

The blast-creation workflow should become:

CREATE

↓

GENERATE

↓

REVIEW

↓

PUBLISH

Every screen should ask one question, present one decision, or perform one clearly defined task.

Do not place multiple unrelated decisions on the same screen.

---

REQUIRED WIZARD STRUCTURE

STEP 1 — CAMPAIGN + BASIC BLAST INFORMATION

This step begins with the existing campaign selection controls (campaign chips, "Build with AI," Quick Create, Cancel — currently `#new-campaign-row`, `BlastyBiz.html:87-98`), then collects the basic blast fields once a campaign is active.

Basic fields:

- Campaign or blast name
- Offer or promotion
- Description
- Price
- Call to action
- Any required timing information

Also place the existing "Extra Facts for AI" factoid panel (`#add-info-card`, `BlastyBiz.html:128-156`, campaign-vs-global scope toggle) on this step as an optional expandable section — not a forced decision, not a separate step. It should default to collapsed.

Do not place the campaign name input and three compressed action buttons in one cramped mobile row.

Use full-width or clearly separated mobile controls.

The actions must not create a mis-tap risk.

---

STEP 2 — PHOTOS AND MEDIA

Allow the user to select, upload, remove, reorder, or confirm photos.

Preserve the existing Campaign vs. Global photo-scope toggle (`#scope-photo-campaign` / `#scope-photo-global`, `BlastyBiz.html:165-168`) on this screen. Do not drop it and do not silently default it — make the current scope visible and switchable here.

Keep photo management on its own screen instead of embedding repeated photo-strip controls inside every platform accordion.

The selected media should remain part of the saved draft.

---

STEP 3 — PLATFORM SELECTION

Show the available platforms as a clean selection screen.

Each platform should display a simple status such as:

- Ready
- Setup Required
- Connected
- Selected
- Not Selected

Do not immediately expose category selectors, signup instructions, signin links, profile URLs, copy controls, sharing tools, and photo controls inside every platform row.

Use progressive disclosure.

Only show additional controls when the user deliberately opens or selects the related task.

**Rule for unconfigured platforms:** Selecting a platform marked "Setup Required" must not block the user from continuing. Toggling it on marks it as selected with a "Setup Required" flag carried into Step 5; Step 5 surfaces the setup block (get-started links, URL field) for that platform only, in place of generated copy, until setup is complete or the user skips it. The rest of the wizard must remain usable regardless of any one platform's setup state.

---

STEP 4 — AI GENERATION

Generate the platform-adapted copy using the existing generation pipeline.

Preserve the existing platform state and adapted-content logic.

The generation system should continue to support:

- Per-platform content
- Per-platform categories
- Existing AI prompts
- Regeneration
- Draft persistence
- Existing error handling
- Existing credit or usage handling
- Existing account-tier limitations

Do not rewrite working generation logic solely to support the new presentation.

---

STEP 5 — PLATFORM-BY-PLATFORM REVIEW

Present one selected platform at a time.

The user should move through the selected platforms using:

- Previous
- Next
- Swipe
- Progress dots or a progress indicator

Each platform review screen should show only what is necessary to review the generated result.

Recommended controls:

- Generated copy
- Edit
- Regenerate
- Approve or Looks Good

For any platform still flagged "Setup Required" (see Step 3), this screen shows the one-time setup block instead of generated copy — get-started/signup/signin links and the profile-URL field currently in `renderQuickSelect()` (`BlastyBiz.html:834-859`, `:862-869`) — until setup is complete or skipped.

Do not display one-time setup instructions, signup links, signin links, category creation, profile URL setup, photo-strip management, share controls, and publishing controls on the same review screen for platforms that are already configured.

Advanced editing should remain available but optional.

The default user path should be:

Generate

↓

Looks Good

↓

Next Platform

Most users should not be forced to edit copy that is already acceptable.

---

STEP 6 — FINAL REVIEW AND PUBLISH

Keep "BlastyBiz-Listing-Preview.html", but change its purpose.

It should become the single final publish screen.

It should not duplicate the platform editing and approval workflow.

The final screen may include:

- Final platform summary
- Approved-content preview
- Selected photos
- Selected platforms
- Scheduling options
- Publish action
- Blast summary
- Clear warnings for anything incomplete

**Relationship to the existing Profile-level auto-post schedule (`#schedule-card`, `BlastyBiz.html:459+`):** the per-blast scheduling option here is for this individual blast's publish timing and does not replace or edit the account-level recurring auto-post schedule. The two are separate settings that happen to share the word "schedule" — do not merge their state or let one silently overwrite the other. If a blast is created while a recurring schedule is active, say so plainly on this screen rather than leaving the interaction implicit.

Do not include:

- Regenerate controls
- Category setup
- Signup instructions
- Platform connection setup
- Repeated Accept buttons
- Full editing workflows already completed in the review wizard

The user should arrive at this page only after all required platform reviews are complete.

---

ONE-TIME PLATFORM SETUP VS. PER-BLAST WORK

Separate these two concepts completely.

ONE-TIME PLATFORM SETUP

The following items should be handled during platform setup, connection, onboarding, or account management:

- Signup links
- Signin links
- Platform account instructions
- Profile or business URLs
- Initial platform category selection
- Custom category creation
- Connection status
- Authentication status
- Any permanent platform configuration

Once a platform is properly configured, these items should not appear during every blast.

PER-BLAST WORK

The blast workflow should contain only information that can change from one blast to another:

- Blast content
- Offer
- Price
- Photos
- Selected platforms
- Generated platform copy
- Optional edits
- Review
- Scheduling
- Publishing

Creating the second, third, and later blasts should become significantly faster than the first one.

---

REMOVE THE FIVE FORCED "ABOUT YOU IN COPY" DECISIONS

Do not force the user to answer five separate Yes/No questions for every blast regarding:

- Name
- Role
- Address
- Phone
- Email

Default these values from the saved business profile and existing business settings.

Replace the five repeated rows with one compact control such as:

"Edit what appears in this blast"

When opened, the user may override the defaults for that blast.

The normal flow should not require the user to make these decisions repeatedly.

Preserve any existing privacy and visibility rules.

Do not automatically expose a field that the user previously configured as private or disabled.

---

USE ONE APPROVAL SYSTEM

There must be one clear approval path.

Remove the ambiguity created by having:

- Per-platform Accept buttons inside accordions
- A separate Review Output button
- A separate Review Listings button
- Another final approval page

Use this approval model:

1. Generate the content.
2. Review one selected platform at a time.
3. Mark each platform as approved.
4. Continue to the final publish screen.
5. Publish or schedule the blast.

Do not make users approve the same content twice.

---

PLATFORM STATUS INDICATORS

Add clear visual status indicators throughout the flow.

Recommended statuses:

- Setup Required
- Ready
- Generating
- Generated
- Needs Review
- Approved
- Failed
- Published
- Skipped

Example presentation:

"Facebook — Approved"

"Craigslist — Needs Review"

"Google Business — Generating"

"Nextdoor — Setup Required"

The user should always be able to tell:

- What has been completed
- What is currently processing
- What still requires attention
- What is blocking publication

Do not rely on color alone.

Include text and, where useful, an icon.

---

PROGRESSIVE DISCLOSURE

Do not render every possible control at once.

Show the simplest useful state first.

Example:

Platform selected

↓

Content generated

↓

User opens Review

↓

Optional editing and regeneration controls appear

Advanced or uncommon controls should remain accessible without dominating the normal flow.

This is especially important on mobile screens.

---

MOBILE REQUIREMENTS

The Create flow must be designed primarily for phone use.

Requirements:

- Avoid horizontal overflow.
- Avoid compressed multi-button rows.
- Use touch targets large enough for one-thumb operation.
- Avoid nested accordions inside long scrolling pages.
- Keep important actions visible and clearly separated.
- Do not require precise tapping between adjacent controls.
- Avoid placing destructive and primary actions beside one another without separation.
- Prevent the fixed footer, sticky controls, or browser viewport behavior from hiding content.
- Test with long platform names and long generated copy.
- Test with the mobile keyboard open.
- Preserve safe spacing at the bottom of each wizard screen.
- Avoid unnecessary page-height or viewport-height assumptions that create blank space.

Each wizard screen should fit within a reasonable mobile viewport whenever possible.

Long generated copy may scroll inside its review area, but the whole application should not become one uncontrolled continuous page.

---

NAVIGATION REQUIREMENTS

The wizard must support:

- Previous
- Next
- Swipe navigation where currently supported
- Progress dots or progress bar
- Current-step label
- Safe return to a previous step
- Draft recovery
- Page refresh without losing completed work
- Browser Back behavior that does not unexpectedly destroy the blast
- Prevention of accidental duplicate generation
- Prevention of accidental duplicate publishing

Do not allow the user to advance past a required step without the minimum required data.

Do not trap the user on a step when an optional platform has failed.

---

PRESERVE EXISTING WORKING LOGIC

This is primarily a presentation-layer and flow refactor.

Preserve the existing implementation unless a specific defect requires a change.

The following must not be casually rewritten:

- "renderQuickSelect()" platform data model
- Per-platform enabled state
- Per-platform category state
- Per-platform adapted content
- AI-generation pipeline
- Draft autosave
- "saveDraft()"
- "debounceCampaignSave()"
- Existing profile data
- Existing account and tier restrictions
- Existing publishing integrations
- Existing category mappings
- Existing platform identifiers
- Existing backend request and response contracts
- Existing Firebase or API persistence
- Existing security checks
- Existing payment or credit enforcement

**Clarification on `renderQuickSelect()`:** "preserve" refers to the underlying platform data model and state (enabled flags, category selections, adapted content) — not the current single monolithic render function. That function currently mixes one-time setup markup with per-blast review markup in one render pass (`BlastyBiz.html:766-900`), which is exactly what Steps 3 and 5 require splitting apart. Rep should split `renderQuickSelect()` into two render paths — one for the Step 3 selection/status view, one for the Step 5 setup-or-review view — both reading from the same underlying platform state object. Do not duplicate or fork the state itself.

The UI may be refactored around these systems.

The underlying contracts should remain stable unless a documented incompatibility makes a targeted change necessary.

Do not silently rename fields, platform IDs, storage keys, element IDs used by business logic, route names, or backend payload properties.

---

STATE MANAGEMENT

Maintain one canonical blast state object or equivalent source of truth for the wizard.

It should include, where already supported:

- Blast ID
- Draft ID
- Current step
- Basic blast fields
- Selected media
- Selected platforms
- Per-platform setup status
- Per-platform category
- Per-platform generated copy
- Per-platform edited copy
- Per-platform review status
- Scheduling choices
- Publishing status
- Error state
- Last saved time

Avoid maintaining competing UI-only and persisted versions of the same information.

Changing steps must not reset generated content or platform approvals.

Returning to an earlier step must preserve later-step work unless the earlier change materially invalidates it.

When a change does invalidate generated output, warn the user before clearing or regenerating anything.

---

AUTOSAVE AND RECOVERY

Preserve the existing autosave implementation.

Add or retain a visible, unobtrusive save status such as:

- Saving
- Saved
- Save Failed
- Last saved at 2:14 PM

Do not block normal navigation for every save.

A failed autosave must be visible and retryable.

On reload, the user should be returned to the saved draft and the most appropriate wizard step.

Do not create multiple drafts because the user refreshed, moved backward, or regenerated one platform.

---

ERROR HANDLING

Errors must be attached to the action or platform that caused them.

Examples:

- Facebook generation failed
- Google Business requires setup
- One photo could not upload
- Draft could not save
- Publishing failed for Craigslist

A failure on one optional platform must not erase successful work from other platforms.

Where supported, allow:

- Retry
- Skip platform
- Return to setup
- Continue with successful platforms

Do not display only a generic "Something went wrong" message when a more specific error is available.

---

ACCESSIBILITY

The refactor must preserve or improve accessibility.

Requirements:

- Form labels connected to controls
- Buttons with clear names
- Keyboard navigation
- Visible focus states
- Status text not conveyed by color alone
- Accessible progress indication
- Accessible expanded/collapsed state
- Appropriate ARIA attributes where needed
- Sufficient text contrast
- Error messages associated with the correct input
- No swipe-only navigation

---

CLEANUP OF THE EXISTING CREATE PAGE

After the new wizard is working:

- Remove obsolete duplicated UI.
- Remove obsolete duplicate Accept controls.
- Remove duplicate Review Output and Review Listings paths where they conflict with the new flow.
- Remove dead event handlers.
- Remove CSS that only supported the retired accordion presentation.
- Remove hidden duplicate components that remain in the DOM unnecessarily.
- Do not leave two competing Create flows active.
- Do not leave old element IDs referenced by active JavaScript after removing the elements.
- Confirm that no query selectors, event listeners, or initialization functions fail because an old element was removed.

Perform cleanup only after confirming that the replacement flow covers the same required functionality.

---

ACCEPTANCE CRITERIA

The work is complete only when all of the following are true:

1. Blast creation uses a true wizard-style mobile flow.

2. The user is not presented with Step 1 and Step 2 as large hidden sections of one long page.

3. Platform selection is separate from platform copy review.

4. One-time platform setup is separated from per-blast creation.

5. The five "About You in Copy" Yes/No rows are replaced by profile-based defaults and one optional edit control.

6. Selected platforms are reviewed one at a time rather than inside a large overloaded accordion list.

7. There is one approval workflow.

8. "BlastyBiz-Listing-Preview.html" acts as the final review, scheduling, and publish screen rather than a duplicate editing and approval screen.

9. Every platform has a clear status.

10. Existing AI-generation logic still works.

11. Existing adapted-content state still works.

12. Existing categories still work.

13. Existing draft autosave still works.

14. Refreshing the page does not destroy the active blast.

15. Moving backward in the wizard does not erase completed work.

16. Regenerating one platform does not overwrite unrelated platforms.

17. A failed platform does not erase successful platforms.

18. No duplicate blast or duplicate publish action is created through repeated taps.

19. The flow works on narrow Android and iPhone-sized viewports.

20. The flow has no horizontal overflow.

21. Buttons do not compress into unsafe tap targets.

22. The mobile keyboard does not hide the active input or primary action.

23. Long generated copy remains reviewable without breaking the page layout.

24. No stale event listeners or missing-element JavaScript errors remain after removing the old UI.

25. Existing backend request formats and persisted field names remain compatible.

26. Campaign selection (chips/Build with AI/Quick Create) and the Extra Facts factoid panel are present and functional within Step 1.

27. The Campaign vs. Global photo-scope toggle is present and functional within Step 2.

28. Selecting an unconfigured ("Setup Required") platform in Step 3 does not block progression through the rest of the wizard.

29. Per-blast scheduling and the account-level recurring auto-post schedule remain distinct, and neither silently overwrites the other.

---

REQUIRED TEST PASS

Test at minimum:

BASIC FLOW

- Create a new blast.
- Enter basic information.
- Add photos.
- Select one platform.
- Generate copy.
- Approve the platform.
- Reach final review.
- Publish or complete the existing publish-stage behavior.

MULTI-PLATFORM FLOW

- Select several platforms.
- Generate content.
- Review each platform.
- Regenerate only one platform.
- Approve all platforms.
- Confirm unrelated platforms remain unchanged.

DRAFT FLOW

- Begin a blast.
- Leave before completion.
- Reload the page.
- Resume from the correct state.
- Confirm photos, selected platforms, copy, edits, and approvals remain intact.

SETUP-REQUIRED FLOW

- Select a platform that is not configured.
- Confirm the user receives a clear Setup Required status.
- Confirm the wizard does not block progression past Step 3 because of this platform.
- Complete or skip setup at Step 5.
- Confirm the rest of the blast remains intact.

FAILURE FLOW

- Simulate a generation failure for one platform.
- Confirm successful platforms remain available.
- Retry or skip the failed platform.
- Continue without losing the draft.

MOBILE FLOW

- Test narrow portrait mode.
- Test the keyboard open.
- Test long business names.
- Test long campaign names.
- Test long generated copy.
- Test many selected platforms.
- Confirm no horizontal overflow, clipped controls, hidden buttons, or excessive blank page space.

---

IMPLEMENTATION RULE

Do not treat this as permission to redesign unrelated pages or rewrite the backend.

Keep the scope centered on:

- The Create tab in "BlastyBiz.html"
- The wizard pattern from "BlastyBiz-Onboarding.html"
- The platform review presentation
- The relationship with "BlastyBiz-Listing-Preview.html"
- Supporting CSS and JavaScript directly required by this flow

Any required backend or data-contract change must be documented before implementation with:

- The exact existing behavior
- Why the current contract cannot support the wizard
- The proposed change
- The affected callers
- The migration or compatibility plan
- The regression tests required

The desired result is a cleaner presentation over the existing working systems, not an unnecessary rebuild of the application.

---

STAGED DELIVERY (recommended given review bandwidth)

Given review constraints, deliver and verify in stages rather than as one large PR:

- **Stage 1:** Steps 1–2 (Campaign/basic info, Photos). Verify autosave and draft-resume behavior survive the wizard conversion before anything else proceeds.
- **Stage 2:** Steps 3–5 (Platform selection, Generation, Platform-by-platform review), including the `renderQuickSelect()` split.
- **Stage 3:** Step 6 (Final review/publish) and the cleanup pass on the old Create page.

Each stage should be reviewable and testable independently before the next stage begins.

---

FILE/LINE REFERENCE MAP (current code being replaced)

- Campaign picker (chips, Build with AI, Quick Create, Cancel): `BlastyBiz.html:76-100`, cramped button row at `:87-98`
- Ad fields (name/offer/price): `BlastyBiz.html:104-126`
- Extra Facts for AI panel: `BlastyBiz.html:128-156`
- Photo upload + scope toggle: `BlastyBiz.html:158-175`
- Step 1 → Step 2 transition: `goToStep1()` / `goToStep2()`, `BlastyBiz.html:1735, 1743`
- Platform quick-select list container: `BlastyBiz.html:197`
- "About You in Copy" five Yes/No rows: `BlastyBiz.html:205-255`
- AI loading/generate button: `BlastyBiz.html:257-267`
- Rewrite/Clear controls: `BlastyBiz.html:270-277`
- Review Output link (duplicate approval surface #1): `BlastyBiz.html:280-282`
- Review Listings link (duplicate approval surface #2): `BlastyBiz.html:316-318`
- Per-platform accordion render (the component to split): `renderQuickSelect()`, `BlastyBiz.html:766-900`
- Profile-level recurring auto-post schedule (do not conflate with per-blast scheduling): `#schedule-card`, `BlastyBiz.html:459+`
- Reference pattern to reuse for wizard structure: `BlastyBiz-Onboarding.html` (`.slide`, `.wiz-header`, `.progress-track`, `.step-dots`, `nextStep()`/`prevStep()`)
