'use strict';
const axios = require('axios');
const { userBizConnsRef, _setConnTokens } = require('./db');

// ── Internal publishing helpers ───────────────────────────────────────────────
// Used by dispatchPublishJob (trigger), adminRetryJob (admin), and
// checkPlatformTokenExpiry (scheduled).

async function _googleRefreshToken(refreshToken) {
  const resp = await axios.post('https://oauth2.googleapis.com/token', null, {
    params: {
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }
  });
  return resp.data.access_token;
}

async function _publishGoogleJob(job, conn) {
  const content   = job.payload?.adaptedContent || '';
  const imageUrls = job.payload?.imageUrls || [];
  // v1 Business Profile Postings API (mybusiness v4 was deprecated 2022)
  async function tryPost(token) {
    return axios.post(
      `https://mybusinesspostings.googleapis.com/v1/locations/${conn.locationId}/localPosts`,
      { languageCode: 'en-US', summary: content,
        media: imageUrls.map(u => ({ mediaFormat: 'PHOTO', sourceUrl: u })) },
      { headers: { Authorization: `Bearer ${token}` } }
    );
  }
  try {
    const r = await tryPost(conn.accessToken);
    return { postId: r.data.name };
  } catch(e) {
    if (e.response?.status === 401 && conn.refreshToken) {
      const newToken  = await _googleRefreshToken(conn.refreshToken);
      const gConnRef  = userBizConnsRef(job.uid, job.businessId).doc('google');
      await _setConnTokens(gConnRef, { accessToken: newToken });
      const { admin } = require('./db');
      await gConnRef.update({ updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      const r = await tryPost(newToken);
      return { postId: r.data.name };
    }
    throw new Error('Google API: ' + (e.response?.data?.error?.message || e.message));
  }
}

async function _publishFacebookJob(job, conn) {
  const content = job.payload?.adaptedContent || '';
  try {
    const r = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.pageId}/feed`,
      { message: content, access_token: conn.accessToken }
    );
    return { postId: r.data.id };
  } catch(e) {
    throw new Error('Facebook API: ' + (e.response?.data?.error?.message || e.message));
  }
}

async function _publishInstagramJob(job, conn) {
  const content  = job.payload?.adaptedContent || '';
  const imageUrl = job.payload?.imageUrls?.[0] || '';
  // Instagram requires an image — fall back to manual_required if none supplied
  if (!imageUrl) {
    return { manualFallback: true, reason: 'no_image',
             message: 'Instagram posts require an image. Copy your caption and post it manually.' };
  }
  try {
    const media = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.igUserId}/media`,
      { image_url: imageUrl, caption: content, access_token: conn.accessToken }
    );
    const pub = await axios.post(
      `https://graph.facebook.com/v18.0/${conn.igUserId}/media_publish`,
      { creation_id: media.data.id, access_token: conn.accessToken }
    );
    return { postId: pub.data.id };
  } catch(e) {
    throw new Error('Instagram API: ' + (e.response?.data?.error?.message || e.message));
  }
}

module.exports = { _googleRefreshToken, _publishGoogleJob, _publishFacebookJob, _publishInstagramJob };
