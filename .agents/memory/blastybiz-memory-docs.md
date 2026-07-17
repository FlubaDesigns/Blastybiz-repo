---
name: BlastyBiz memory docs
description: globalMemory + campaignMemory architecture — how they're created, stored, and injected into AI prompts.
---

## What they are
- **globalMemory** — rich 2-4 paragraph text doc written by Claude after the onboarding interview. Captures everything the AI should always know about the business: story, differentiators, customers, personality, memorable details. Permanent once set.
- **campaignMemory** — rich paragraph(s) written by Claude after the campaign interview. Captures the hook, specific items, urgency, audience, and what makes the campaign unique. Per-campaign.

## Where they live in Firestore
- `globalMemory`: field on `users/{uid}/businesses/{bizId}` doc (string)
- `campaignMemory`: field on each campaign doc at `users/{uid}/businesses/{bizId}/campaigns/{campId}` (string)

## How they're created
- `chatOnboard` CF (claude-haiku-4-5): scripted phase on `BlastyBiz-Chat-Onboarding.html` collects basics, then AI interview generates globalMemory. Saved via `createBusiness` CF which uses `{ merge: true }` — extra fields (globalMemory, description) pass through automatically.
- `chatCampaign` CF (claude-haiku-4-5): scripted phase in `BlastyBiz.html` campaign modal collects campaign basics, then AI interview generates campaignMemory. Saved as `campaignMemory` field on the campaign object by `_bbSaveCampaigns`.

## How they're injected into adaptListing
In `functions/index.js` adaptListing CF:
```javascript
const { aiContext, globalMemory, campaignMemory } = listing;
const globalMemoryBlock = globalMemory ? '📋 GLOBAL BUSINESS MEMORY...\n' + globalMemory : '';
const campaignMemoryBlock = campaignMemory ? '🎯 CAMPAIGN MEMORY...\n' + campaignMemory : '';
// Injected before aiContextBlock in the prompt
```
On the client (`BlastyBiz.html`):
```javascript
window._globalMemory = biz.globalMemory || '';  // set on profile load
// In the adaptListing fetch body:
globalMemory: window._globalMemory || profile.globalMemory || '',
campaignMemory: (campaigns.find(c=>c.id===activeCampaignId)||{}).campaignMemory || '',
```

## Priority in the prompt
globalMemoryBlock → campaignMemoryBlock → aiContextBlock (legacy) → libraryDocsBlock → campaignContextBlock → bizInsights → globalFactoids → campaignFactoids

**Why:** globalMemory and campaignMemory are the authoritative, rich-text briefing docs; everything else is supplementary.

## CFs pattern
Both chatOnboard and chatCampaign:
- Require Bearer auth (verifyBearer)
- Use claude-haiku-4-5 (fast, cheap for conversational Q&A)
- Take conversationHistory[] + contextData
- Return {done:false, message} OR {done:true, message, <memoryField>}
- Call trackAiUsage for billing
- No AI usage limit check (one-time setup flows, not counted against monthly cap)
