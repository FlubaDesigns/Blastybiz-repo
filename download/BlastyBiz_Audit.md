# BlastyBiz — Bug Fix Audit Log

| Date | File(s) | What was wrong | How it was fixed |
|------|---------|----------------|-----------------|
| 2026-07-18 | BlastyBiz.html, global-style.css | Blast-creation flow used a flat two-step show/hide approach (create-step-1 / create-step-2) with no visual progress, and forced five repeated "About You in Copy" Yes/No decisions on every blast. | Rebuilt the Create tab as a 3-slide wizard (Stage 1 of spec). Added progress bar, step dots, step labels. Slide 1 = Campaign + Blast Info + Extra Facts. Slide 2 = Photos (own step). Slide 3 = Platforms + Generate (unchanged logic). Collapsed the five YN rows behind a single "Edit what appears in this blast" accordion — defaults come from profile, user can override per-blast. Removed dead `step2-back` and `about-you-card` CSS. Bumped global-style.css to v=59. |
