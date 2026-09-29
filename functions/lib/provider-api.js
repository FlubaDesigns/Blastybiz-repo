'use strict';
// Pin one supported Graph version across connect, refresh, publish and revoke.
// Reviewed 2026-09-29: developers.facebook.com/docs/graph-api/changelog/
const META_GRAPH_VERSION = 'v25.0';
const META_GRAPH_BASE = 'https://graph.facebook.com/' + META_GRAPH_VERSION;
const providerId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
function googlePostsUrl(conn) {
  if (!providerId(conn.accountId) || !providerId(conn.locationId)) throw Error('Reconnect Google and choose a Business Profile before posting.');
  return `https://mybusiness.googleapis.com/v4/accounts/${conn.accountId}/locations/${conn.locationId}/localPosts`;
}
module.exports = {META_GRAPH_VERSION, META_GRAPH_BASE, providerId, googlePostsUrl};
