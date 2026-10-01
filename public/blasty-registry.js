/* Seeded from bb_v1 Parts 2B, 6D and 11B; 11C overrides applied. */
window.BBBlastySeed = {
  "events": {
    "onboard.experience_choice": {
      "eventId": "onboard.experience_choice",
      "message": "Hi! I’m Blasty. I can walk you through setting up your business, or if you already know what you’re doing, I can stay out of the way. Your choice!",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "3",
      "purpose": "Step 0 — First Appearance",
      "note": "Arrival/settle; happy; wave; normal flame; light chase; small smoke."
    },
    "onboard.guided_selected": {
      "eventId": "onboard.guided_selected",
      "message": "You got it! I’ll stick with you. We’ll start with your business info, then I’ll help you build your first campaign.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "3",
      "purpose": "Step 0A — Guided Choice",
      "note": "Happy bounce; thumbs-up; cone pop; brief green flame; light sequence."
    },
    "onboard.forms_selected": {
      "eventId": "onboard.forms_selected",
      "message": "Got it. I’ll stay out of your way. If you need me, I’m right here.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "3",
      "purpose": "Step 0A — Direct Forms Choice",
      "note": "Relaxed settle; wink; normal/low flame; quiet."
    },
    "onboard.email_handoff_explain": {
      "eventId": "onboard.email_handoff_explain",
      "message": "Perfect. Before we go any further, I need to make sure I can get you back here.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "3",
      "purpose": "Step 5A — Email Handoff",
      "note": "Point toward email/inbox cue; blue emphasis; soft pulse."
    },
    "onboard.email_sent_waiting": {
      "eventId": "onboard.email_sent_waiting",
      "message": "Sent! Check {{email}}. If you don’t see me, take a peek in spam or junk too. I’ll be here when you get back.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "3",
      "purpose": "Step 5B — Email Sent / Waiting",
      "note": "Happy bounce → waiting idle; thumbs-up; point to displayed email/change controls; green bump."
    },
    "onboard.email_return_success": {
      "eventId": "onboard.email_return_success",
      "message": "There you are, {{ownerName}}! I told you I’d be here.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "4",
      "purpose": "Return Frame",
      "note": "Arrival/landing; wave; wink; green bump; light chase; tiny smoke."
    },
    "profile.no_website_reassure": {
      "eventId": "profile.no_website_reassure",
      "message": "No problem. You don’t need one to use BlastyBiz.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "4",
      "purpose": "Step 11B-No",
      "note": "Reassuring open hand; no negative reaction."
    },
    "onboard.story_complete": {
      "eventId": "onboard.story_complete",
      "message": "Perfect, {{ownerName}}. Now I know {{businessName}} — where you came from, what makes you different, what you’ve accomplished, and who your customers are.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "5",
      "purpose": "Story Complete",
      "note": "Celebrate then settle; eyePop; both thumbs; green flame; full chase; coneSpin; small smoke; no confetti."
    },
    "onboard.campaigns_explain": {
      "eventId": "onboard.campaigns_explain",
      "message": "Next, we’re going to create your first campaign.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "5",
      "purpose": "Transition — Explain Campaigns",
      "note": "openHandsBoth; pointSelf on memory; point toward CTA; soft blue → brief green."
    },
    "campaign.first_open_explain": {
      "eventId": "campaign.first_open_explain",
      "message": "This is Campaigns. This is where we take everything I know about your business and decide what you want to market.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "6/6A",
      "purpose": "Campaigns Opening — First Campaign",
      "note": "Open hands; pointSelf; soft blue; soft pulse."
    },
    "ad.first_create_intro": {
      "eventId": "ad.first_create_intro",
      "message": "Campaign: {{campaignName}}. Now let’s make the first ad for it.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6A",
      "purpose": "First Ad inside Campaign",
      "note": "Short returning/transition frame; campaign-to-ad distinction."
    },

    "platform.selection_explain": {
      "eventId": "platform.selection_explain",
      "message": "Choose where this campaign should go. If a platform needs to be connected, I’ll help you do it here.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "6/6A",
      "purpose": "Send To Opening",
      "note": "Under 6A selected platforms belong to Ad. Open-hand toward list."
    },
    "platform.connection_needed": {
      "eventId": "platform.connection_needed",
      "message": "You picked {{platform}}. I can post there for you, but first I need you to connect your account.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6",
      "purpose": "Send To — Connection Needed",
      "note": "Point directly to inline Connect; restrained blue/normal flame."
    },
    "platform.connection_success": {
      "eventId": "platform.connection_success",
      "message": "Got it — {{platform}} is connected. I’ll keep it selected for this campaign.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "6",
      "purpose": "Send To — Connection Success",
      "note": "Thumbs-up; brief green flame; pulse/chase."
    },
    "platform.manual_explain": {
      "eventId": "platform.manual_explain",
      "message": "{{platform}} doesn’t let me post directly, but I can still build the content and make the last step easy for you.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6",
      "purpose": "Send To — Manual Platform",
      "note": "reassureHand; never failure animation."
    },
    "ad.run_again_scope": {
      "eventId": "ad.run_again_scope",
      "message": "Sure. Want to run {{adName}} exactly like last time, or change anything just for this run?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Run Again Decision",
      "note": "Choices RUN AS-IS / CHANGE THIS RUN. Brief returning-user behavior."
    },
    "ad.run_again_timing": {
      "eventId": "ad.run_again_timing",
      "message": "Got it. When should I run {{adName}} again?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Run As-Is Timing",
      "note": "Choices SEND NOW / SCHEDULE IT."
    },
    "ad.run_again_schedule_confirm": {
      "eventId": "ad.run_again_schedule_confirm",
      "message": "{{adName}} will Blast on {{date}} at {{time}}.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Run Again Schedule Confirmation",
      "note": "Truthful date/time readback."
    },
    "ad.change_this_run_scope": {
      "eventId": "ad.change_this_run_scope",
      "message": "No problem. These changes will be for this Blast only. {{adName}} itself will stay the same.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Change This Run Scope",
      "note": "Reassuring; occurrence-only."
    },
    "ad.promote_override_offer": {
      "eventId": "ad.promote_override_offer",
      "message": "This is starting to look like a new ad. Want me to save it as a new ad in {{campaignName}}?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Change Becomes New Ad",
      "note": "Choices KEEP AS THIS RUN ONLY / SAVE AS NEW AD."
    },
    "ad.use_as_starting_point": {
      "eventId": "ad.use_as_starting_point",
      "message": "Want to use {{adName}} as the starting point?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "6B",
      "purpose": "Use As Starting Point",
      "note": "Creates new Ad; never edits source."
    },
    "generate.ready": {
      "eventId": "generate.ready",
      "message": "Okay, {{ownerName}} — I’ve got what I need.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7/6A",
      "purpose": "Generate Copy Transition",
      "note": "Under 6A generation is for current Ad. openHandsBoth; pointSelf; blue emphasis; point to Generate."
    },
    "generate.working": {
      "eventId": "generate.working",
      "message": "Facebook and Yelp don’t want the same kind of post. I’m formatting each one for where it’s going.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Generation Wait",
      "note": "One event with variants; working body/mouth; blue flame; subtle lights; platform-tracking eyes."
    },
    "generate.platform_regenerate": {
      "eventId": "generate.platform_regenerate",
      "message": "Got it. I’ll try a different angle for {{platform}}.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Per-Platform Regeneration",
      "note": "One event with variants; cost remains visible."
    },
    "review.first_explain": {
      "eventId": "review.first_explain",
      "message": "Each platform has its own version. You can edit anything I wrote, ask me to try that one again, or tap Looks Good when you’re happy with it.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "First Review Explanation",
      "note": "First Campaign/Ad only."
    },
    "generate.complete": {
      "eventId": "generate.complete",
      "message": "Done! I made a version for each platform. Now take a look and make sure you like what I wrote.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Generation All Successful",
      "note": "Readiness, not publish celebration."
    },
    "generate.partial_failure": {
      "eventId": "generate.partial_failure",
      "message": "I got {{readyCount}} finished, but {{failedCount}} didn’t come back right. Your campaign is fine — we can retry those individually.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Generation Partial Failure",
      "note": "Reassure; no global failure framing."
    },
    "review.platform_approved": {
      "eventId": "review.platform_approved",
      "message": "{{platform}} looks good. Next one.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "One Platform Approved",
      "note": "Small nod; brief green pulse."
    },
    "review.all_approved": {
      "eventId": "review.all_approved",
      "message": "That’s everything. Every platform is ready.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "All Platforms Approved",
      "note": "Thumbs-up; green flame; full light chase; optional coneSpin; no confetti."
    },
    "publish.first_arrival": {
      "eventId": "publish.first_arrival",
      "message": "Nice! Your campaign is built. This is your final check before anything goes out.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Publish Page Arrival",
      "note": "Happy arrival/settle; reassureHand; soft green pulse."
    },
    "publish.summary_explain": {
      "eventId": "publish.summary_explain",
      "message": "Here’s the campaign I’m about to send.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "7/6A",
      "purpose": "Blast Summary Explain",
      "note": "Under 6A summary is current Ad; point to summary; do not narrate every field."
    },
    "publish.delivery_modes_explain": {
      "eventId": "publish.delivery_modes_explain",
      "message": "See these? Some platforms let me post for you automatically. Others make us do the last step ourselves.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Auto vs Manual Explain",
      "note": "Must reflect actual user/platform state."
    },
    "publish.preview_explain": {
      "eventId": "publish.preview_explain",
      "message": "Want to double-check my work? Pick any platform here and I’ll show you exactly what’s going there.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Preview Rail Explain",
      "note": "Point to selector/preview; quiet while reading."
    },
    "publish.manual_destinations_explain": {
      "eventId": "publish.manual_destinations_explain",
      "message": "These platforms won’t let me post directly, but I’m not leaving you hanging.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Manual Publish Page Explain",
      "note": "reassureHand; conditional only."
    },
    "publish.upgrade_explain": {
      "eventId": "publish.upgrade_explain",
      "message": "These versions are ready now. With automatic posting enabled, I could handle the final posting step for the supported platforms too.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Upgrade Area Explain",
      "note": "Neutral; must not interrupt or imply incomplete."
    },
    "publish.ready": {
      "eventId": "publish.ready",
      "message": "That’s it. Take one last look.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Ready to Publish",
      "note": "Point to action; no auto-advance."
    },
    "publish.working": {
      "eventId": "publish.working",
      "message": "Launching the versions I can send automatically…",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Publish Wait",
      "note": "One event with variants; working + blue flame; no success celebration yet."
    },
    "publish.returning_ready": {
      "eventId": "publish.returning_ready",
      "message": "Everything’s ready. Give it a final look and publish whenever you’re ready.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "7",
      "purpose": "Later Campaign Publish Shorthand",
      "note": "Use after first-use teaching is complete."
    },
    "ai.allowance_near": {"eventId":"ai.allowance_near","message":"Fresh wording is nearly at this month’s allowance. Saved copy and Run As-Is stay available.","behavior":"WHEN NEEDED","animation":[],"enabled":true,"source":"11C.4"},
    "schedule.intent_choice": {
      "eventId": "schedule.intent_choice",
      "message": "Everything looks good. Want me to send it now, or should we schedule it?",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Send Now vs Schedule It",
      "note": "Choices SEND NOW / SCHEDULE IT."
    },
    "schedule.time_choice_explain": {
      "eventId": "schedule.time_choice_explain",
      "message": "Pick something quick, or choose the exact date and time yourself.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Schedule Time Choice",
      "note": "Quick choices + exact calendar/clock."
    },
    "schedule.refire_explain": {
      "eventId": "schedule.refire_explain",
      "message": "I call that Refire — you build this campaign once and I can keep running it for you.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Refire Explain",
      "note": "Only after first-run time exists."
    },
    "schedule.first_three_review_explain": {
      "eventId": "schedule.first_three_review_explain",
      "message": "For your first three scheduled posts, I’ll send you a preview before anything goes out.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "First Three Approval Safety",
      "note": "Informational; not optional during safety period."
    },
    "schedule.saved_summary": {
      "eventId": "schedule.saved_summary",
      "message": "Got it. {{campaignName}} starts Friday at 9 AM, Refires monthly for 8 posts, and I’ll refresh the copy while keeping these images.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Schedule Save Readback",
      "note": "Generate from actual settings; under 6A include Ad identity where useful."
    },
    "schedule.ready_to_commit": {
      "eventId": "schedule.ready_to_commit",
      "message": "Everything’s set. Hit Schedule Blast and I’ll take it from here.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Scheduled Final Action",
      "note": "Point to SCHEDULE BLAST."
    },
    "schedule.created": {
      "eventId": "schedule.created",
      "message": "Done! Your first Blast is scheduled.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Schedule Success",
      "note": "Small green flame/light/smoke success; no full confetti."
    },
    "schedule.next_up_summary": {
      "eventId": "schedule.next_up_summary",
      "message": "{{summary}}",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Schedule Tab Next Up",
      "note": "Top Next Up card; permanent contextual role."
    },
    "schedule.paused": {
      "eventId": "schedule.paused",
      "message": "No problem. I’ll hold this campaign until you’re ready.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "8",
      "purpose": "Pause",
      "note": "Calm/reassuring; never error."
    },
    "schedule.context_summary": {
      "eventId": "schedule.context_summary",
      "message": "{{summary}}",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Schedule Contextual Summary",
      "note": "Same eventId as Part 8 dynamic schedule summary; richer state variant."
    },
    "post.auto_success": {
      "eventId": "post.auto_success",
      "message": "{{platform}} is live.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Auto Post Success",
      "note": "Verified API/backend success only."
    },
    "post.auto_failure": {
      "eventId": "post.auto_failure",
      "message": "{{platform}} didn’t go through. The rest of your Blast is fine — let’s fix that one.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Auto Post Failure",
      "note": "Failure isolated to platform; recovery-oriented."
    },
    "post.manual_scheduled_explain": {
      "eventId": "post.manual_scheduled_explain",
      "message": "For platforms I can post to, I’ll publish at the scheduled time. For the others, I’ll have the new copy and images ready for you at that time.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Manual Scheduling Truth",
      "note": "Never call manual preparation scheduled posting."
    },
    "post.manual_confirmed": {
      "eventId": "post.manual_confirmed",
      "message": "Got it. I’ll mark {{platform}} complete for this Refire.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Mark as Posted",
      "note": "Small nod/green pulse; owner-confirmed, not API-verified."
    },
    "post.manual_skipped": {
      "eventId": "post.manual_skipped",
      "message": "No problem. I’ll skip {{platform}} for this occurrence. It’ll still be included next time unless you change the campaign.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Skip This One",
      "note": "Scope must be current Blast only."
    },
    "blast.override_scope_choice": {
      "eventId": "blast.override_scope_choice",
      "message": "Do you want this change just for this post, or for the campaign going forward?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Occurrence Override Scope",
      "note": "Older Campaign wording; under 6A/6B map to THIS BLAST ONLY vs reusable Ad/new-Ad behavior as applicable."
    },
    "publish.partial": {
      "eventId": "publish.partial",
      "message": "I got {{handledCount}} of {{totalCount}} handled. {{manualCount}} are ready for you.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Publishing Status Summary",
      "note": "Point toward Your Turn. Use actual counts."
    },
    "blast.complete": {
      "eventId": "blast.complete",
      "message": "That’s it — this Refire is complete.",
      "behavior": "ALWAYS",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Blast Complete",
      "note": "Strongest celebration only for first-ever completed Blast; later completions restrained."
    },
    "reminder.manual_explain": {
      "eventId": "reminder.manual_explain",
      "message": "If I need you to finish any platforms manually, I’ll send you a reminder so they don’t get forgotten.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "9",
      "purpose": "Manual Reminder Preference Explain",
      "note": "Preference ON/OFF; default ON."
    },
    "onboard.first_blast_complete": {
      "eventId": "onboard.first_blast_complete",
      "message": "You did it, {{ownerName}}. Your first campaign is underway. {{handoff}}",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "10",
      "purpose": "First Blast Completion — Main",
      "note": "Do not frame remaining manual work as failure."
    },
    "onboard.activity_intro": {
      "eventId": "onboard.activity_intro",
      "message": "And I’ll keep everything we do in Activity, so you can see what’s coming, what’s happening, and what we’ve already done.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "10/11",
      "purpose": "Introduce Activity",
      "note": "Point toward Activity. Supersedes Part 10 History wording."
    },
    "onboard.ready_to_blast": {
      "eventId": "onboard.ready_to_blast",
      "message": "That’s it. You’re officially ready to Blast.",
      "behavior": "ONCE",
      "animation": ["eyePop","thumbUpBoth","flameBoost","coneSpin","confetti"],
      "enabled": true,
      "source": "10",
      "purpose": "Final Completion Statement",
      "note": "Full celebration: eyePop, both thumbs, green flame, chase, coneSpin, smoke, confetti; then settle."
    },
    "onboard.first_blast_scheduled": {
      "eventId": "onboard.first_blast_scheduled",
      "message": "You’re set up, {{ownerName}}. Your first campaign is scheduled, and I know what to do when the time comes.",
      "behavior": "ONCE",
      "animation": [],
      "enabled": true,
      "source": "10",
      "purpose": "Completion — Scheduled Variant",
      "note": "Do not claim published/live."
    },
    "activity.empty": {
      "eventId": "activity.empty",
      "message": "Nothing here yet — once we start Blasting, I’ll keep track of it for you.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11",
      "purpose": "Activity Empty — No History",
      "note": "CTA CREATE A CAMPAIGN."
    },
    "activity.no_upcoming": {
      "eventId": "activity.no_upcoming",
      "message": "Nothing scheduled right now.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11",
      "purpose": "Activity Empty — No Upcoming",
      "note": "CTA VIEW SCHEDULE or CREATE A CAMPAIGN."
    },
    "activity.no_attention_needed": {
      "eventId": "activity.no_attention_needed",
      "message": "Nothing needs your attention.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11",
      "purpose": "Activity Empty — No Issues",
      "note": "Positive empty state, not missing-data styling."
    },
    "activity.historical_override_choice": {
      "eventId": "activity.historical_override_choice",
      "message": "This Blast used changes from the original {{adName}}. What do you want to run?",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.historical_original_ad": {
      "eventId": "activity.historical_original_ad",
      "message": "Use the Ad-level Run Again flow.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.historical_this_version": {
      "eventId": "activity.historical_this_version",
      "message": "Use this historical Blast version as the source for a new reusable Ad.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.ad_summary": {
      "eventId": "activity.ad_summary",
      "message": "{{campaignName}} has {{adCount}} ads. {{adName}} has been Blasted {{blastCount}} times and was last used {{lastUsed}}.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.next_blast_summary": {
      "eventId": "activity.next_blast_summary",
      "message": "Your next {{adName}} Blast is scheduled for {{date}} at {{time}}.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.manual_attention_summary": {
      "eventId": "activity.manual_attention_summary",
      "message": "One {{adName}} Blast still needs you to finish {{platform}}.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "activity.draft_ad": {
      "eventId": "activity.draft_ad",
      "message": "Draft Ad status/context may be explained, but the Draft is not a Blast and is not delivered Activity.",
      "behavior": "WHEN NEEDED",
      "animation": [],
      "enabled": true,
      "source": "11B"
    },
    "images.campaign_repository_intro": {
      "eventId": "images.campaign_repository_intro",
      "message": "Photos you upload here stay in Campaign Images. You can also bring in saved Business Images.",
      "behavior": "ONCE",
      "animation": [
        "pointRight"
      ],
      "enabled": true,
      "source": "6D"
    },
    "images.ad_selection_intro": {
      "eventId": "images.ad_selection_intro",
      "message": "Tap a Campaign Image to use it for this Ad. You can also drag it.",
      "behavior": "ONCE",
      "animation": [
        "pointRight"
      ],
      "enabled": true,
      "source": "6D"
    },
    "images.first_ad_image_selected": {
      "eventId": "images.first_ad_image_selected",
      "message": "It's still saved with your campaign. We're just using it for this Ad.",
      "behavior": "ONCE",
      "animation": [
        "nod"
      ],
      "enabled": true,
      "source": "6D"
    },
    "images.repository_help": {
      "eventId": "images.repository_help",
      "message": "Campaign Images are your reusable collection. Images for This Ad are this Ad's selected photos.",
      "behavior": "OPTIONAL",
      "animation": [
        "nod"
      ],
      "enabled": true,
      "source": "6D"
    },
    "recoverable_error": {
      "eventId": "recoverable_error",
      "message": "{{message}}",
      "behavior": "WHEN NEEDED",
      "animation": [
        "reassureHand"
      ],
      "enabled": true,
      "source": "2A"
    }
  },
  "fields": {
    "profile.ownerName": {
      "message": "Step 1 — Owner Name",
      "enabled": true,
      "source": "3"
    },
    "profile.businessName": {
      "message": "Step 2 — Business Name",
      "enabled": true,
      "source": "3"
    },
    "profile.role": {
      "message": "Step 3 — Role",
      "enabled": true,
      "source": "3"
    },
    "profile.contactEmail": {
      "message": "Step 4 — Email",
      "enabled": true,
      "source": "3"
    },
    "profile.phone": {
      "message": "Step 5 — Phone",
      "enabled": true,
      "source": "3"
    },
    "profile.locationType": {
      "message": "Step 6 — Location Type",
      "enabled": true,
      "source": "4"
    },
    "profile.website": {
      "message": "Step 7O — Website",
      "enabled": true,
      "source": "4"
    },
    "profile.street": {
      "message": "Step 7B — Street",
      "enabled": true,
      "source": "4"
    },
    "profile.city": {
      "message": "Step 8B — City",
      "enabled": true,
      "source": "4"
    },
    "profile.state": {
      "message": "Step 9B — State",
      "enabled": true,
      "source": "4"
    },
    "profile.zip": {
      "message": "Step 10B — ZIP",
      "enabled": true,
      "source": "4"
    },
    "profile.hasWebsite": {
      "message": "Step 11B — Has Website",
      "enabled": true,
      "source": "4"
    },
    "story.origin": {
      "message": "Story 1",
      "enabled": true,
      "source": "5"
    },
    "story.differentiation": {
      "message": "Story 2",
      "enabled": true,
      "source": "5"
    },
    "story.proof": {
      "message": "Story 3",
      "enabled": true,
      "source": "5"
    },
    "story.idealCustomer": {
      "message": "Story 4",
      "enabled": true,
      "source": "5"
    },
    "story.additionalContext": {
      "message": "Story 5",
      "enabled": true,
      "source": "5"
    },
    "campaign.name": {
      "message": "Campaign Name",
      "enabled": true,
      "source": "6"
    },
    "ad.name": {
      "message": "Ad Name",
      "enabled": true,
      "source": "6A"
    },
    "ad.offer": {
      "message": "Offer / Focus",
      "enabled": true,
      "source": "6/6A"
    },
    "ad.priceDeal": {
      "message": "Price / Deal",
      "enabled": true,
      "source": "6/6A"
    },
    "ad.imageRefs": {
      "message": "Photos",
      "enabled": true,
      "source": "6/6A"
    },
    "ad.context": {
      "message": "Teach Blasty About This Ad",
      "enabled": true,
      "source": "6A"
    },
    "ad.mentions": {
      "message": "Mentions",
      "enabled": true,
      "source": "6/6A"
    },
    "ad.cta": {
      "message": "Call to Action",
      "enabled": true,
      "source": "6/6A"
    },
    "schedule.copyBehavior": {
      "message": "Copy Behavior",
      "enabled": true,
      "source": "8"
    },
    "schedule.imageBehavior": {
      "message": "Image Behavior",
      "enabled": true,
      "source": "8"
    }
  }
};
