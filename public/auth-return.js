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
    const tabs = ['profile','story','create','platforms','schedule','history','account'];
    if (q.has('tab')) { if (!tabs.includes(q.get('tab'))) return null; params.tab = q.get('tab'); }
    for (const k of ['cid','adId','draftId','scheduleCampaign','scheduleAd','scheduledBlastId','sourceBlastId']) {
      if (q.has(k)) { if (!valid(q.get(k))) return null; params[k] = q.get(k); }
    }
    if (q.has('step')) { if (!['1','5'].includes(q.get('step'))) return null; params.step = q.get('step'); }
    if (q.get('newcampaign') === '1') params.newcampaign = '1';
    if (!!params.scheduleAd !== !!params.scheduleCampaign) return null;
  } else if (/^\/BlastyBiz-Listing-Preview(?:\.html)?$/.test(pathname)) {
    page = 'BlastyBiz-Listing-Preview.html';
    if (!valid(q.get('draftId'))) return null;
    params.draftId = q.get('draftId');
  } else if (/^\/BlastyBiz-Connect(?:\.html)?$/.test(pathname)) {
    page = 'BlastyBiz-Connect.html';
    if (q.get('returnTo') === 'onboarding') params.returnTo = 'onboarding';
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

// Connection detours reuse the same allowlist and owner/business checks.
export function rememberConnectionReturn(pathname, search, ownerUid) {
  const target = parseAuthReturn(pathname, search);
  if (!target) return;
  target.params.ownerUid = ownerUid;
  sessionStorage.setItem('bb_connection_return', JSON.stringify(target));
}
export function connectionReturn(ownerUid, bizId) {
  const target = restoreAuthReturn(sessionStorage.getItem('bb_connection_return'));
  return target && target.params.ownerUid === ownerUid && target.params.bizId === bizId
    ? target.page + '?' + new URLSearchParams(target.params) : null;
}
