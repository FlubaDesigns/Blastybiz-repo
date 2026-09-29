'use strict';
// Read-only verification: never publishes a post, sends mail, or changes customer data.
const assert = require('node:assert/strict');
(async () => {
  assert(process.env.GITHUB_SHA, 'GITHUB_SHA is required');
  for (const host of ['https://blastybiz-9523e.web.app', 'https://blastybiz.com']) {
    const response = await fetch(host + '/release.json?verify=' + Date.now(), {signal: AbortSignal.timeout(30000)});
    assert(response.ok, `${host}: release marker HTTP ${response.status}`);
    assert.equal((await response.json()).commit, process.env.GITHUB_SHA, `${host}: wrong deployed commit`);
    for (const [page, text] of [
      ['BlastyBiz', 'lifecycle-ui.js'],
      ['BlastyBiz-Listing-Preview', 'v1-publish-schedule'],
      ['BlastyBiz-Publishing-Status', 'lifecycle-status.js'],
      ['BlastyBiz-Admin', 'ai-cost-rollups.js'],
      ['BlastyBiz', 'async function deletePhotoRecords'],
      ['BlastyBiz', 'async function retryGeneratedDraftSave'],
      ['BlastyBiz', '_bbUpdateDraftSchedule'],
      ['BlastyBiz-Admin-OnboardSteps', 'blasty-admin.js'],
      ['BlastyBiz-Profile', 'BlastyBiz-CreateBiz.html'],
      ['BlastyBiz-Story', 'BlastyBiz-CreateBiz.html'],
      ['BlastyBiz-Publishing-Status', 'manual_followup'],
      ['BlastyBiz-Account', 'Plan &amp; Billing'],
      ['BlastyBiz-CreateBiz', 'cbNormalizeWebsite'],
      ['BlastyBiz-Admin-Queue-Manager', 'publicationUncertain'],
      ['BlastyBiz-Admin-Subscriptions', 'function renderRevenue'],
      ['BlastyBiz-Admin-Failed-Jobs', 'Legacy retry status']
    ]) {
      const result = await fetch(`${host}/${page}?verify=${Date.now()}`, {signal: AbortSignal.timeout(30000)});
      assert(result.ok, `${host}/${page}: HTTP ${result.status}`);
      assert((await result.text()).includes(text), `${host}/${page}: reviewed change missing`);
    }
    console.log(`PASS: ${host} serves ${process.env.GITHUB_SHA} and all reviewed page markers.`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
