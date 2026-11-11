# Publishing controls — issue 38, section 4

Issue [#38](https://github.com/FlubaDesigns/Blastybiz-repo/issues/38) owns completion status. This inventory records where existing controls remain after the approved presentation changes.

| Existing function | Location after the change | Existing owner |
| --- | --- | --- |
| Destination readiness, connection repair, missing photo | Beside the destination name | Platform readiness and saved packet |
| Copy full post, open destination, download actual photo | Primary tools grouped under that destination | Photo handoff and clipboard |
| Copy each photo, phone Share, instructions, view full copy | Destination’s normal right-side three-dot menu | Same photo handoff functions |
| Business, category, offer, phone, area | Preview header three-dot → Blast details | Saved packet |
| Final review, guarded Blast action, tracking link, back to Ad | Visible primary controls | Existing approveDraft path |
| Refresh publishing and destination settings | Publish header three-dot menu | Existing controls moved, never cloned |
| Edit copy/photos, review/regenerate/approve, schedule/hold, view saved content | Proposed post’s right-side menu | BBAds and existing workspace navigation |
| Upcoming photo, local date/time, platform icons, approval state | Compact schedule card in Publish and Schedule | Same renderSchedules, Ad.schedule and frozen packet |
| Pause/resume, review and approval | Visible on upcoming card | Existing manageBlast actions and review confirmation |
| Edit schedule/photos, skip next, move next, schedule details, cancel | Upcoming card’s right-side menu | Existing schedule editor and mutation actions |
| Exact copy/photos, save this occurrence, refresh wording, reusable Ad link | Review panel opened by Review & approve | Existing packet revision checks |
| Timezone, frequency, stop count, copy/image/approval options, upload/AI image selection | Existing schedule editor opened by Edit Schedule & Photos | Existing schedule form and photo picker |
| Last-run results/status | Three-dot → Schedule details | Saved Blast and publishJobs |
| Paused/completed schedules | Upcoming header three-dot menu | Same schedule list response |
| Business scheduling resume and legacy schedule pause/open | Existing visible controls | Existing manageBlast actions |
| Manual Mark as Posted, eligible Retry, Connect | Visible primary status actions | Existing confirmation, uncertainty and connection guards |
| Skip one, details, instructions and photo Share/Copy | Destination status three-dot menu | Same existing actions |
| Skip remaining | Results summary three-dot menu | Existing confirmation and API action |
| Reminders, estimated time saved, history, schedules, create | Status header three-dot menu | Existing preference and navigation |
| Future scheduling from sent Blast | Visible status action | Existing source-Blast scheduling |

No additional schedule, delivery, approval, photo or URL store was introduced. Before an occurrence is prepared, the compact card reads its image from the existing schedule editor API, including its source-Blast and repeat-image rules. The destination URL map now lives in the existing canonical platform module and its generated browser asset. Page layout remains in global-style.css. The three-dot button and menu controls have one shared owner in Buttons.css, as directed by Dave. The existing cache-version hook stamps both stylesheets.

Validation includes the existing release gate, action and stale-selection regression checks, real browser phone/desktop layouts, and isolated authenticated live acceptance. The live fixture keeps business scheduling paused and creates no real posts or paid model requests.
