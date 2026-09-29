// One allowlisted return destination for legacy drafts, lifecycle links and OAuth.
// No externally supplied URL or path is ever used for navigation.
export function parseAuthReturn(pathname, search) {
  const q = new URLSearchParams(search);
  const valid = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const bizId = q.get('bizId'), ownerUid = q.get('ownerUid');
  if (!valid(bizId) || (ownerUid !== null && !valid(ownerUid))) return null;
  const params = {bizId};
  if (ownerUid) params.ownerUid = ownerUid;
  let page;
  if (/^\/BlastyBiz(?:\.html)?$/.test(pathname)) {
    page = 'BlastyBiz.html';
    if (q.get('tab') === 'schedule') {
      params.tab = 'schedule';
      for (const k of ['scheduleCampaign','scheduleAd','scheduledBlastId']) {
        if (!valid(q.get(k))) return null;
        params[k] = q.get(k);
      }
    } else {
      if (!valid(q.get('draftId'))) return null;
      params.draftId = q.get('draftId');
    }
  } else if (/^\/BlastyBiz-Publishing-Status(?:\.html)?$/.test(pathname)) {
    page = 'BlastyBiz-Publishing-Status.html';
    if (!valid(q.get('draftId'))) return null;
    params.draftId = q.get('draftId');
  } else if (/^\/BlastyBiz-Connected(?:\.html)?$/.test(pathname)) {
    page = 'BlastyBiz-Connected.html';
    const platform = q.get('connected') || q.get('error');
    if (!['google','facebook'].includes(platform)) return null;
    params[q.has('error') ? 'error' : 'connected'] = platform;
    if (q.has('selection')) {
      if (!valid(q.get('selection'))) return null;
      params.selection = q.get('selection');
    }
    if (q.get('returnTo') === 'onboarding') params.returnTo = 'onboarding';
  } else return null;
  return {page, params};
}
export function restoreAuthReturn(raw) {
  try {
    const value = JSON.parse(raw);
    // Upgrade the original draft-only representation in the same storage key.
    return parseAuthReturn('/' + (value.page || 'BlastyBiz.html'), new URLSearchParams(value.params || value));
  } catch (_) { return null; }
}
