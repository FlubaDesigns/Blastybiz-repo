'use strict';
const { db, admin } = require('./db');

// ── Yelp Category Cache ─────────────────────────────────────────────────────
// Used by both the admin refreshYelpCategories endpoint and the weekly
// scheduledYelpCategoryRefresh cron job.
async function fetchAndCacheYelpCategories() {
  const apiKey = process.env.YELP_API_KEY;
  if (!apiKey) throw new Error('YELP_API_KEY secret is not configured');

  const resp = await fetch('https://api.yelp.com/v3/categories?locale=en_US', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Yelp API error ${resp.status}: ${text}`);
  }
  const data = await resp.json();

  const cats = (data.categories || [])
    .filter(c => {
      if (c.country_whitelist && c.country_whitelist.length > 0 && !c.country_whitelist.includes('US')) return false;
      if (c.country_blacklist && c.country_blacklist.includes('US')) return false;
      return true;
    })
    .map(c => c.title)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

  await db.collection('platformCategoryCache').doc('yelp').set({
    cats,
    fetchedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: 'yelp_api',
    count: cats.length,
  });

  console.log(`[yelpCategories] Cached ${cats.length} categories`);
  return cats;
}

module.exports = { fetchAndCacheYelpCategories };
