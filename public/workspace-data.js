import { saveCampaignImage } from './photo-library.js?v=20261002';
import { compressImage } from './photo-preparation.js?v=20261002';
import { auth, db, storage } from './firebase-init-v2.js?v=20261111-cleanup';
import { onAuthStateChanged, signOut, isSignInWithEmailLink, signInWithEmailLink } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  doc, getDoc, setDoc, addDoc, collection, serverTimestamp, writeBatch, deleteDoc,
  query, where, getDocs, orderBy, limit, updateDoc, arrayUnion, arrayRemove, increment,
  onSnapshot, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

// ── awaitPaidPlan ────────────────────────────────────────────────────────────
// Called only when the owner has just come back from Square checkout. Payment
// confirmation arrives via the squareWebhook Cloud Function, not via the
// redirect, so the plan on users/{uid} can still say 'starter' at this moment.
// Rather than briefly showing free-plan limits to someone who just paid, hold
// on a confirming state until the webhook lands (or we give up waiting).
const PAY_CONFIRM_TIMEOUT_MS = 90000;

function awaitPaidPlan(uid) {
  const el = document.getElementById('pay-confirm');
  if (el) el.hidden = false;

  return new Promise((resolve) => {
    let settled = false;
    let unsub = null;
    let timer = null;

    const applyPlan = async (plan) => {
      userPlan = plan;
      window.userPlan = plan;
      window._bbUserPlan = plan;
      window._bizLimit = await BBPlans.businessLimit(plan);
      if (typeof renderAgencyBar === 'function') renderAgencyBar();
      if (typeof window._applyPlanOverlays === 'function') window._applyPlanOverlays();
    };

    const finish = async (plan) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (unsub) { try { unsub(); } catch (_) {} }
      if (plan) await applyPlan(plan);
      if (el) el.hidden = true;
      resolve(plan || null);
    };

    try {
      unsub = onSnapshot(doc(db, 'users', uid), (snap) => {
        const plan = snap.exists() ? (snap.data().plan || 'starter') : 'starter';
        if (plan === 'pro' || plan === 'agency') finish(plan);
      }, (e) => {
        console.error('[awaitPaidPlan] snapshot error', e);
        finish(null);
      });
    } catch (e) {
      console.error('[awaitPaidPlan] listener failed', e);
      finish(null);
      return;
    }

    timer = setTimeout(async () => {
      // Still unconfirmed. One last direct read in case the listener missed it
      // (offline mode, dropped stream), then let them get on with their blast
      // rather than trap them here — the paid-welcome email will catch up.
      try {
        const snap = await getDoc(doc(db, 'users', uid));
        const plan = snap.exists() ? (snap.data().plan || 'starter') : 'starter';
        if (plan === 'pro' || plan === 'agency') { finish(plan); return; }
      } catch (e) { console.warn('[awaitPaidPlan] final read failed', e); }

      const t = document.getElementById('pay-confirm-title');
      const s = document.getElementById('pay-confirm-sub');
      if (t) t.textContent = 'Still confirming…';
      if (s) s.textContent = 'Your payment is going through but the confirmation is slow. Carry on — we\u2019ll email you and unlock everything the moment it lands.';
      setTimeout(() => finish(null), 4000);
    }, PAY_CONFIRM_TIMEOUT_MS);
  });
}
import { loadPlatforms, PLATFORM_DEFAULTS, deliveryReadiness } from './platforms-config.js?v=20261018-personal-facebook';
import { rememberConnectionReturn } from './auth-return.js?v=20261011-security';
window._bbPlatformReadiness = p => deliveryReadiness(p.id, window._bbConnections === undefined ? undefined : window._bbConnections[p.id] || null, {business:profile,images:window.BBAds?.active?.imageRefs});
window._bbOpenConnections = async function(){
  try{if((window.BBAds?.operationBusy ?? window.BBAds?.busy) || window._bbAdaptationBusy || window._bbDraftSavePending)throw Error('Finish saving your work before connecting an account.');
    if(window.BBAds?.active)await window.BBAds.save();
    window._bbRecordWorkspaceRoute?.(true);rememberConnectionReturn(location.pathname,location.search,currentUser.uid);
    location.assign('BlastyBiz-Connect.html?'+new URLSearchParams({bizId:window.activeBizId}));
  }catch(e){showToast(e.message);}
};
import {
  ref as storageRef, uploadBytesResumable, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

window.doSignOut = () => window._bbSignOut(auth, signOut);

// ── Bridge to the classic <script> block further down ────────────────────────
// That block (Story tab, Business Library, Account tab) is NOT a module, so it
// cannot see anything imported or declared here — every bare `getDoc`, `db`,
// `currentUser` or `activeBizId` in it resolves against window instead. Without
// this bridge those tabs throw ReferenceError the moment they are opened.
// Session values are accessors, not snapshots, so the classic block always sees
// the current signed-in user rather than the null captured at load time. The
// setters keep the existing `window.activeBizId = …` / `window.userPlan = …`
// assignments in that block working, and write back to the module's variables.
Object.assign(window, { db, doc, getDoc, setDoc, addDoc, getDocs, deleteDoc, updateDoc, collection, query, orderBy });
// Account deletion needs to sign out, but it lives in the classic block and cannot
// see `auth`. Exposed as a narrow helper rather than putting `auth` on window.
window._bbAuthSignOut = () => signOut(auth);
Object.defineProperty(window, 'currentUser', {
  configurable: true, get: () => currentUser, set: (v) => { currentUser = v; },
});
Object.defineProperty(window, 'activeBizId', {
  configurable: true, get: () => activeBizId, set: (v) => { activeBizId = v; },
});
Object.defineProperty(window, 'userPlan', {
  configurable: true, get: () => userPlan, set: (v) => { userPlan = v; },
});

// ── Magic-link trial sign-in ─────────────────────────────────────────
if (isSignInWithEmailLink(auth, window.location.href)) {
  let _mlEmail = window.localStorage.getItem('bb_trial_email');
  if (!_mlEmail) _mlEmail = window.prompt('Please confirm your email address:') || '';
  if (_mlEmail) {
    signInWithEmailLink(auth, _mlEmail, window.location.href)
      .then(async (result) => {
        window.localStorage.removeItem('bb_trial_email');
        const _mlName = window.localStorage.getItem('bb_trial_name') || '';
        window.localStorage.removeItem('bb_trial_name');
        await setDoc(doc(db, 'users', result.user.uid), {
          plan: 'trial',
          displayName: _mlName,
          email: _mlEmail,
          createdAt: new Date().toISOString(),
        }, { merge: true });
        // Clean up Firebase URL params
        const _clean = new URL(window.location.href);
        ['oobCode','apiKey','mode','lang'].forEach(p => _clean.searchParams.delete(p));
        history.replaceState(null, '', _clean.toString());
      })
      .catch(e => console.error('Magic link error:', e));
  }
}

let currentUser = null;
let activeBizId = null;
let userPlan = 'starter';
let _enabledPlatformIds = null; // authoritative enabled set from biz doc

// Exposed to regular script — module owns db + activeBizId
window._bbSavePlatformSelections = async function(enabledIds) {
  if (!activeBizId || !currentUser) return;
  const batch=writeBatch(db);
  batch.set(doc(db,'users',currentUser.uid,'businesses',activeBizId),{enabledPlatforms:enabledIds},{merge:true});
  if(window._currentDraftId)batch.update(doc(db,'users',currentUser.uid,'businesses',activeBizId,'listingDrafts',window._currentDraftId),{enabledPlatforms:enabledIds,'schedule.approved':false});
  await batch.commit();
};

// Load all listingDrafts that have a schedule field, return map keyed by draftId
window._bbLoadDraftSchedules = async function() {
  if (!currentUser || !activeBizId) return {};
  const colRef = collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts');
  const snap = await getDocs(colRef);
  const result = {};
  snap.forEach(d => {
    const data = d.data();
    if (!data.schedule) return;
    result[d.id] = {
      schedule:     data.schedule,
      blastName:    data.blastName || data.offerHeadline || 'Blast',
      campaignId:   data.campaignId   || '',
      campaignName: data.campaignName || '',
      platforms:    (data.enabledPlatforms || []).map(p => ({ google:'Google', facebook:'Facebook', instagram:'Instagram', tiktok:'TikTok', yelp:'Yelp', nextdoor:'Nextdoor', linkedin:'LinkedIn', twitter:'X' }[p] || p)),
    };
  });
  return result;
};

// Save schedule back to a specific draft doc
window._bbSaveDraftSchedule = async function(draftId, schedule) {
  if (!currentUser || !activeBizId || !draftId) return;
  const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', draftId);
  await updateDoc(ref, { schedule, updatedAt: serverTimestamp() });
};


window._bbSaveCampaigns = async function(cams) {
  if (!activeBizId || !currentUser) throw new Error('No active business');
  if (!cams.length) return;
  const batch = writeBatch(db);
  cams.forEach(cam => {
    const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns', cam.id);
    const safe={...cam};for(const key of ['adName','offer','price','cta','mentions','adaptations','ynMentionName','ynMentionFirstName','ynMentionLastName','ynMentionRole','ynMentionAddress','ynMentionPhone','ynMentionEmail','ynMentionWebsite'])delete safe[key];
    batch.set(ref, { ...safe, uid: currentUser.uid, bizId: activeBizId }, { merge: true });
  });
  await batch.commit();
};

window._bbDeleteCampaign = async function(campId) {
  if (!activeBizId || !currentUser) throw new Error('Please sign in and select a business.');
  const token=await currentUser.getIdToken();
  const response=await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/deleteCampaign',{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
    body:JSON.stringify({bizId:activeBizId,campaignId:campId})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.error || 'Campaign could not be removed.');
};

// Copy Library — Firestore helpers exposed to regular script
window._bbSaveLibraryItem = async function(item) {
  if (!currentUser || !activeBizId) throw new Error('Not authenticated');
  await addDoc(collection(db, 'copyLibrary'), {
    uid: currentUser.uid,
    bizId: activeBizId,
    ...item,
    adId:window.BBAds?.active?.id||item.adId||null,
  });
};

window._bbLoadLibrary = async function(campaignId) {
  if (!currentUser) throw new Error('Not authenticated');
  const q = query(
    collection(db, 'copyLibrary'),
    where('uid', '==', currentUser.uid),
    where('bizId', '==', activeBizId),
    where('campaignId', '==', campaignId),
    orderBy('savedAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.filter(d=>!d.data().retired).map(d => ({ docId: d.id, ...d.data() }));
};

window._bbDeleteLibraryItem = async function(docId) {
  if (!currentUser) throw new Error('Not authenticated');
  await deleteDoc(doc(db, 'copyLibrary', docId));
};

window._bbSaveCampaignMemory = async function(campId, text, target) {
  if (!currentUser || currentUser.uid !== target.uid || !target.businessId || !campId) throw new Error('Please sign in again.');
  await updateDoc(doc(db, 'users', target.uid, 'businesses', target.businessId, 'campaigns', campId), { campaignMemory: text });
};
window._bbAppendBusinessMemory = async function(fact, target) {
  if (!currentUser || currentUser.uid !== target.uid || activeBizId !== target.businessId) throw new Error('The business changed.');
  const ref = doc(db, 'users', target.uid, 'businesses', target.businessId);
  return runTransaction(db, async tx => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Business not found.');
    const existing = snap.data().globalMemory || '';
    const memory = ('\n' + existing + '\n').includes('\n' + fact + '\n') ? existing : [existing, fact].filter(Boolean).join('\n');
    tx.update(ref, { globalMemory: memory });
    return memory;
  });
};

// ── Global business facts (facts subcollection) ───────────────────────────────
window._bbSaveGlobalMemory = async function(text) {
  if (!activeBizId || !currentUser) return;
  await updateDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId), { globalMemory: text });
};

window._bbSaveGlobalFact = async function(fact) {
  if (!activeBizId || !currentUser) return null;
  const ref = await addDoc(
    collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'facts'),
    { ...fact, uid: currentUser.uid, bizId: activeBizId, createdAt: serverTimestamp() }
  );
  return ref.id;
};

window._bbScoreAndSaveFact = async function(factId, text, scope, campId) {
  if (!currentUser || !activeBizId) return;
  try {
    const token = await currentUser.getIdToken();
    const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/scoreFact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ text })
    });
    if (!resp.ok) return;
    const { score } = await resp.json();
    if (score == null) return;
    if (scope === 'global') {
      await updateDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'facts', factId), { importance: score });
      const f = (window._globalFactoids || []).find(x => x.id === factId);
      if (f) f.importance = score;
    } else if (campId) {
      await updateDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns', campId, 'facts', factId), { importance: score });
      const cam = campaigns.find(c => c.id === campId);
      if (cam && cam.factoids) { const f = cam.factoids.find(x => x.id === factId); if (f) f.importance = score; }
    }
    if (window.renderFactoidQuickLook) window.renderFactoidQuickLook();
  } catch(_) { /* silent — scoring is non-critical */ }
};

window._bbDeleteGlobalFact = async function(factId) {
  if (!activeBizId || !currentUser || !factId) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'facts', factId));
};

window._bbLoadGlobalFacts = async function() {
  if (!activeBizId || !currentUser) return [];
  const snap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'facts'));
  return snap.docs.filter(d=>!d.data().retired).map(d => ({ ...d.data(), id: d.id }));
};

// ── Global business images (images subcollection) ─────────────────────────────
window._bbSaveGlobalImage = async function(imageData, bizId = activeBizId) {
  if (!bizId || !currentUser) return null;
  const ref = await addDoc(
    collection(db, 'users', currentUser.uid, 'businesses', bizId, 'images'),
    { ...imageData, uid: currentUser.uid, bizId, scope: 'global', createdAt: serverTimestamp() }
  );
  return ref.id;
};

window._bbLoadGlobalImages = async function() {
  if (!activeBizId || !currentUser) return [];
  const snap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'images'));
  return snap.docs.filter(d=>!d.data().retired).map(d => ({ ...d.data(), id: d.id }));
};

// Delete every representation of the same image together, using the existing records.
async function deletePhotoRecords(image, campId = null) {
  const bizId = image.bizId || activeBizId;
  if (!bizId || !currentUser) throw new Error('Business is not ready');
  const uid = currentUser.uid;
  const bizRef = doc(db, 'users', uid, 'businesses', bizId);
  const campRef = campId ? doc(db, 'users', uid, 'businesses', bizId, 'campaigns', campId) : null;
  const parts = ['users', uid, 'businesses', bizId, ...(campId ? ['campaigns', campId] : []), 'images'];
  const refs = image.id ? [doc(db, ...parts, image.id)] : image.url
    ? (await getDocs(query(collection(db, ...parts), where('url', '==', image.url)))).docs.map(d => d.ref) : [];
  let remainingPhotos = null;
  let clearedFeatured = false;
  await runTransaction(db, async tx => {
    const biz = await tx.get(bizRef);
    const camp = campRef ? await tx.get(campRef) : null;
    remainingPhotos = null;
    clearedFeatured = !!image.url && biz.exists() && biz.data().featuredPhoto === image.url;
    if (camp?.exists() && Array.isArray(camp.data().photos)) {
      remainingPhotos = camp.data().photos.filter(p => (typeof p === 'string' ? p : p.url) !== image.url);
      tx.update(campRef, {photos: remainingPhotos});
    }
    if (clearedFeatured) tx.update(bizRef, {featuredPhoto: ''});
    refs.forEach(ref => tx.update(ref,{retired:true,retiredAt:serverTimestamp()}));
  });
  if (activeBizId === bizId) {
    if (clearedFeatured && window._bbFeaturedPhotoUrl === image.url) window._bbFeaturedPhotoUrl = '';
    if (campId && remainingPhotos) {
      const campaign = campaigns.find(c => c.id === campId);
      if (campaign) campaign.photos = remainingPhotos;
    }
    if (!campId) window._globalImages = (window._globalImages || []).filter(i => i.url !== image.url);
  }
}
window._bbDeleteGlobalImage = image => deletePhotoRecords(image);

// ── Campaign facts subcollection ──────────────────────────────────────────────
window._bbLoadCampaignFactoids = async function(campId) {
  if (!activeBizId || !currentUser || !campId) return [];
  const snap = await getDocs(
    collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns', campId, 'facts')
  );
  return snap.docs.filter(d=>!d.data().retired).map(d => ({ ...d.data(), id: d.id }));
};

window._bbSaveCampaignFact = async function(campId, fact) {
  if (!activeBizId || !currentUser || !campId) return null;
  const ref = await addDoc(
    collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns', campId, 'facts'),
    { ...fact, uid: currentUser.uid, bizId: activeBizId, campaignId: campId, createdAt: serverTimestamp() }
  );
  return ref.id;
};

// ── Campaign images subcollection ─────────────────────────────────────────────
window._bbLoadCampaignImages = async function(campId) {
  if (!activeBizId || !currentUser || !campId) return [];
  const snap = await getDocs(
    collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns', campId, 'images')
  );
  return snap.docs.filter(d=>!d.data().retired).map(d => ({ ...d.data(), id: d.id }));
};

window._bbSaveCampaignImage = async function(campId, imageData, bizId = activeBizId) {
  if (!bizId || !currentUser || !campId) return null;
  return saveCampaignImage(campId, imageData, bizId, currentUser.uid);
};

window._bbDeleteCampaignImage = (campId, image) => deletePhotoRecords(image, campId);

// ── Insight + globalFactoids savers — must be module-scoped for activeBizId ──
window._saveInsightToFirestore = async function(insights) {
  if (!activeBizId || !currentUser) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId),
      { bizInsights: insights }, { merge: true });
  } catch(e) { console.error('saveInsights:', e); }
};

async function loadWorkspaceSelection(user, userData, requestedId) {
  const snap = await getDocs(collection(db, 'users', user.uid, 'businesses'));
  const businesses = snap.docs.map(d => ({ ...d.data(), id: d.id }));
  const selected = businesses.find(b => b.id === (requestedId || userData.activeBusiness));
  if (requestedId && !selected) throw new Error('This profile is no longer available. Open your dashboard to select a profile.');
  const active = selected || businesses[0] || null;
  if (active && !requestedId && active.id !== userData.activeBusiness) {
    await setDoc(doc(db, 'users', user.uid), { activeBusiness: active.id }, { merge: true });
  }
  return { businesses, active };
}

auth.authStateReady().then(() => {
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // auth-guard.js handles redirect
  const emailOwner = new URLSearchParams(window.location.search).get('ownerUid');
  if (emailOwner && emailOwner !== user.uid) {
    showToast('This preview belongs to another account. Sign out and use the account that received it.');
    return;
  }
  currentUser = user;
  window._bbUid = currentUser.uid;
  window._bbGetToken  = () => currentUser.getIdToken();
  window._bbCurrentUid = currentUser.uid;

  const userSnap = await getDoc(doc(db, 'users', user.uid));
  const userData = userSnap.exists() ? userSnap.data() : {};
  let selection;
  try {
    selection = await loadWorkspaceSelection(user, userData, new URLSearchParams(window.location.search).get('bizId'));
  } catch (e) {
    showToast(e.message || 'Could not load your profile. Reload to try again.');
    return;
  }
  if (!selection.active) {
    // Resume saved Personal signup without the business setup screen.
    window.location.replace(userData.setupHandoff?.sellerType === 'personal' ? 'BlastyBiz-Login.html?intent=signin' : 'BlastyBiz-CreateBiz.html');
    return;
  }
  window.BUSINESSES = selection.businesses;
  activeBizId = selection.active.id;
  userPlan = userData.plan || 'starter';
  window._bbUserPlan = userPlan;
  window.activeBizId = activeBizId;
  window._bizLimit = await BBPlans.businessLimit(userPlan);
  if (typeof window._applyPlanOverlays === 'function') window._applyPlanOverlays();
  renderPlatforms();

  // The switcher and profile use the same owned-profile selection.
  try {
    if (typeof renderSwitcherBar === 'function') { renderSwitcherBar(); renderAgencyBar(); }
  } catch(e) { console.error('renderSwitcherBar error:', e); }

  // Allow switching business from the bar
  window.switchBusiness = async function(bizId) {
    if (window.BBLifecycle?.hasUnsavedChanges?.()&&!window.BBLifecycle.canLeave())return;
    if (window._bbDraftSavePending) { showToast('Use Retry save before switching businesses.'); return; }
    if (window._bbAdaptationBusy || (window.BBAds?.operationBusy ?? window.BBAds?.busy)) { showToast('Wait for the current save or generation to finish.'); return; }
    try { if (window.BBAds?.active) await window.BBAds.save(); }
    catch (e) { showToast('Could not save your changes. Please retry before switching.'); return; }
    try { await flushCampaignMemoryEdits(); } catch { showToast('Save your campaign details before switching.'); return; }
    await setDoc(doc(db, 'users', user.uid), { activeBusiness: bizId }, { merge: true });
    activeBizId = bizId;
    window.activeBizId = bizId;
    if (typeof renderSwitcherBar === 'function') { renderSwitcherBar(); renderAgencyBar(); }
    window.location.assign('BlastyBiz.html?' + new URLSearchParams({bizId,tab:'create'}));
  };

  // ── Add a new business — show Wizard vs Form choice modal ──
  window.addBusiness = async function() {
    if (!currentUser) return;
    const bizList = window.BUSINESSES || [];
    const limit = window._bizLimit;
    if (limit != null && bizList.length >= limit) {
      const msg = `You've reached your ${limit}-business limit. Upgrade your plan to add more.`;
      if (window.showToast) window.showToast(msg); else alert(msg);
      return;
    }
    document.getElementById('cb-choose-modal').style.display = 'flex';
  };

  // ── Delete the selected business (requires confirmation; server enforces ownership) ──
  window.deleteBusiness = async function(bizId) {
    if (!bizId || !currentUser) return;
    const list = window.BUSINESSES || [];
    const biz = list.find(b => b.id === bizId);
    if (!biz) return;
    const bizName = biz.name || biz.businessName || 'this business';
    if (list.length <= 1) {
      const msg = 'You need at least one business.';
      if (window.showToast) window.showToast(msg); else alert(msg);
      return;
    }
    if (!confirm(`Delete "${bizName}"? This cannot be undone.`)) return;
    const delBtn = document.querySelector('.del-biz-btn');
    if (delBtn) { delBtn.disabled = true; }
    try {
      const tok = await currentUser.getIdToken();
      const resp = await fetch('https://us-central1-blastybiz-9523e.cloudfunctions.net/deleteBusiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok },
        body: JSON.stringify({ bizId })
      });
      const result = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(result.error || 'Could not delete business.');
      window.BUSINESSES = list.filter(b => b.id !== bizId);
      if (window.activeBizId !== result.activeBusiness) {
        activeBizId = result.activeBusiness;
        window.activeBizId = result.activeBusiness;
        window.location.reload();
      } else {
        if (typeof renderSwitcherBar === 'function') { renderSwitcherBar(); renderAgencyBar(); }
      }
      if (window.showToast) window.showToast(`"${bizName}" deleted.`);
      if (delBtn) delBtn.disabled = false;
    } catch (e) {
      console.error('[deleteBusiness]', e);
      const msg = e.message || 'Could not delete business. Please try again.';
      if (window.showToast) window.showToast(msg); else alert(msg);
      if (delBtn) { delBtn.disabled = false; }
    }
  };

  try {
    const bizSnap = await getDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId));
    if (!bizSnap.exists()) { window.location.replace('BlastyBiz-CreateBiz.html'); return; }
    if (bizSnap.exists()) {
      const biz = bizSnap.data();
      window._bbFeaturedPhotoUrl = biz.featuredPhoto || '';
      const p = {
        sellerType: biz.sellerType || 'business',
        name:         biz.sellerType === 'personal' ? (biz.ownerName || biz.name || '') : (biz.businessName || biz.name || ''),
        ...BBSetup.nameParts(biz),
        ownerRole:    biz.ownerRole  || 'owner',
        category:     biz.category   || '',
        phone:        biz.phone || '',
        email:        biz.email || '',
        street:       biz.street || (typeof biz.address==='string'?biz.address:biz.address?.street) || '',
        city:         biz.city   || biz.address?.city || '',
        state:        biz.state  || biz.address?.state || '',
        zip:          biz.zip    || biz.address?.zip || '',
        get address() { return [this.street, this.city, this.state, this.zip].filter(Boolean).join(', '); },
        region:       biz.region || '',
        locationType: biz.locationType || 'physical',
        website:      biz.website || '',
        hours:        biz.hours || (biz.openTime ? biz.days + ' ' + biz.openTime + '–' + biz.closeTime : ''),
        tone:         biz.tone || 'friendly',
        platformCats: biz.platformCats || {},
        postingSchedule: biz.postingSchedule || null,
        aiContext:    biz.aiContext || null,
        globalMemory: biz.globalMemory || '',
        ynMentionFirstName: BBSetup.profileMentions(biz).firstName,
        ynMentionLastName: BBSetup.profileMentions(biz).lastName,
        ynMentionRole:    biz.ynMentionRole    || 'no',
        ynMentionAddress: biz.ynMentionAddress || 'yes',
        ynMentionPhone:   biz.ynMentionPhone   || 'yes',
        ynMentionEmail:   biz.ynMentionEmail   || 'yes',
        ynMentionWebsite: biz.ynMentionWebsite || 'yes',
      };
      if (window._bbSetProfile) window._bbSetProfile(p);
      window._globalMemory = biz.globalMemory || '';
      window._bbPlatPrefs  = biz.platformPrefs || {};
      if (window.loadInsights) window.loadInsights(biz.bizInsights || []);

      // Refresh admin platform config via authenticated Firestore (more reliable than the
      // pre-auth REST call). Must run before restoring user selections so _bbSetPlatforms
      // has the latest admin config when it applies the enabled/proOnly/name/icon overrides.
      try {
        const activePlatforms = await loadPlatforms(db, getDoc, doc);
        const adminMap = {};
        PLATFORM_DEFAULTS.forEach(d => { adminMap[d.slug] = { ...d, enabled: false }; });
        activePlatforms.forEach(p => { adminMap[p.slug] = p; });
        window._bbAdminPlatformConfig = adminMap;
      } catch(e) {
        console.warn('[BlastyBiz] loadPlatforms (auth) failed:', e.message);
      }

      // Restore saved platform selections (cross-device)
      if (biz.enabledPlatforms && Array.isArray(biz.enabledPlatforms)) {
        _enabledPlatformIds = biz.enabledPlatforms;
        // Always restore — even an empty array is a valid "all off" selection
        const restored = window.PLATFORMS.map(p => ({ ...p, enabled: _enabledPlatformIds.includes(p.id) }));
        if (window._bbSetPlatforms) window._bbSetPlatforms(restored);
        try { localStorage.setItem('bb_platforms_enabled', JSON.stringify(_enabledPlatformIds)); } catch(e) {}
      } else {
        // New user with no saved selections — seed defaults from admin config so admin
        // changes to enabled-by-default state take effect immediately for new users.
        const adminMap = window._bbAdminPlatformConfig;
        const seeded = window.PLATFORMS.map(p => {
          const adminEntry = adminMap && adminMap[p.id];
          const adminEnabled = adminEntry ? adminEntry.enabled : p.enabled;
          return { ...p, enabled: adminEnabled !== false && adminEnabled !== undefined ? !!adminEnabled : false };
        });
        if (window._bbSetPlatforms) window._bbSetPlatforms(seeded);
      }

      // Load global factoids from subcollection
      try {
        const factsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'facts'));
        window._globalFactoids = factsSnap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch(_) {
        window._globalFactoids = [];
      }

      // Load global images subcollection
      try {
        const imgSnap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'images'));
        window._globalImages = imgSnap.docs.map(d => ({ ...d.data(), id: d.id }));
      } catch(_) { window._globalImages = []; }

      // Load Business Library docs for AI context (Pro/Agency only — no-op for starter)
      try {
        const docsSnap = await getDocs(query(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'documents'), orderBy('uploadedAt', 'desc')));
        window._libraryDocs = docsSnap.docs.map(d => ({ name: d.data().name, extractedText: d.data().extractedText || '' }));
      } catch(_) { window._libraryDocs = []; }

      // ?tab=X — nav links from the site header route here so onboarded users skip the mascot wizard
      const _tabParam = new URLSearchParams(window.location.search).get('tab');
      if (_tabParam && ['publishing','profile','story','create','platforms','schedule','history','account'].includes(_tabParam)) {
        showTab(_tabParam);
      }

      // ?edit=1 from Dashboard "Edit Business Info" button — jump straight to Profile tab
      if (new URLSearchParams(window.location.search).get('edit') === '1') {
        window.history.replaceState({}, '', window.location.pathname);
        showTab('profile');
        setTimeout(() => {
          const nameInput = document.getElementById('profile-name');
          if (nameInput) { nameInput.focus(); nameInput.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        }, 150);
      }


      // Load campaigns from sub-collection (hierarchical model)
      const campColSnap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'campaigns'));
      campaigns = campColSnap.docs.map(d => ({ ...d.data(), id: d.id })).filter(c=>c.status!=='archived');
      window._bbCampaigns = campaigns;
      _sortCampaigns();
      renderCampaignChips();
      // Seed per-campaign schedule map from saved campaign docs
      renderScheduleTab();

      // URL param handling — ?newcampaign=1 auto-opens the create form
      // ?cid=xxx auto-selects an existing campaign
      const _qp = new URLSearchParams(window.location.search);
      const _qpCid = _qp.get('cid');
      if (_qp.get('draftId')) {
        await loadHistoryDraft(_qp.get('draftId'));
      } else if (_qpCid) {
        const _qpCamp = campaigns.find(c => c.id === _qpCid);
        if (_qpCamp) {
          await selectCampaign(_qpCamp.id, _qpCamp.name, {adId:_qp.get('adId')});
          // The original handoff resumes only after the same saved Ad is loaded.
          if (_qp.get('autogenerate') === '1') {
            window._bbFromOnboarding = true;
            const cameFromCheckout = _qp.get('checkout') === '1';
            window.history.replaceState({}, '', window.location.pathname + '?bizId=' + activeBizId + '&cid=' + encodeURIComponent(_qpCamp.id));
            if (cameFromCheckout) await awaitPaidPlan(user.uid);
            if (window.BBAds?.active) await createWizNext(1, !platforms.some(p => p.enabled && p.adaptedContent));
          }
        }
      } else if (campaigns.length && !_qp.get('newcampaign')) {
        // Auto-select most-recently-used campaign so the form is visible on load
        const autoC = [...campaigns].sort((a,b) => new Date(b.lastUsedAt||b.createdAt||0) - new Date(a.lastUsedAt||a.createdAt||0))[0];
        await selectCampaign(autoC.id, autoC.name);
      } else if (_qp.get('newcampaign') === '1') {
        showTab('create');
        openNewCampaign();
        window._bbFirstRun = _qp.get('firstrun') === '1';
        if (window._bbFirstRun) {
          const listCard = document.getElementById('create-camp-list-card');
          if (listCard) {
            const banner = document.createElement('div');
            banner.id = 'firstrun-banner';
            banner.style.cssText = 'padding:14px 0 6px;border-bottom:1px solid var(--border);margin-bottom:10px;';
            banner.innerHTML = '<div class="bb-style-e0325363">👋 Welcome! Let\'s create your first campaign.</div>'
              + '<div class="bb-style-d3732619">Name your campaign below — something like <em>Grand Opening</em> or <em>Holiday Special</em>.<br/>Then fill in what you\'re offering. AI will write the rest.</div>';
            listCard.prepend(banner);
          }
        }
      }
      // Campaign loading opens Create; restore the explicitly requested tab last.
      const requestedStep = Number(_qp.get('step'));
      if (SLIDE_IDS.includes(requestedStep) && _qp.get('autogenerate') !== '1') createWizGoTo(requestedStep, false, {record:false, scroll:false});
      if (_tabParam && ['publishing','profile','story','create','platforms','schedule','history','account'].includes(_tabParam)) showTab(_tabParam);
      window._bbWorkspaceNavigationReady = true;
      window._bbRecordWorkspaceRoute(true);
    }
  } catch(e) {
    console.error('Profile load error:', e);
    showToast('Could not load your saved profile. Reload to try again.');
    return;
  }

  // One preparation path for every photo: identify bytes, decode, resize, encode JPEG.
  // ── Photo upload (scope-aware: campaign subcollection or global images) ───────
  window._bbUploadPhoto = async function(file, uploadContext = {}) {
    if (!file) return;
    const scope = uploadContext.scope || (activeCampaignId ? 'campaign' : (photoScope || 'global'));
    const cid = uploadContext.campaignId !== undefined ? uploadContext.campaignId : activeCampaignId;
    const bizId = uploadContext.bizId || activeBizId;
    // Guard: campaign upload requires an active campaign
    if (scope === 'campaign' && !cid) {
      if (window.showToast) window.showToast('Select a campaign first before uploading campaign photos.');
      return;
    }
    const uploadAdId=window.BBAds?.active?.id;
    let localUrl = null;
    const uploadId = Date.now() + '_' + Math.random().toString(36).slice(2,8);
    const storagePath = scope === 'global'
      ? `photos/${currentUser.uid}/global/${uploadId}.jpg`
      : `photos/${currentUser.uid}/campaigns/${cid}/${uploadId}.jpg`;
    const item = { url: null, path: storagePath, localUrl, done: false, progress: 0, uploadId, scope, campaignId: cid, bizId, compressing: true };
    window._bbPhotoItems = window._bbPhotoItems || [];
    window._bbPhotoUploads.add(item);
    if (photoUploadMatchesView(item)) window._bbPhotoItems.push(item);
    if (window.renderAllPhotos) window.renderAllPhotos();

    const fail = message => {
      item.compressing = false; item.error = true; item.errorMsg = message;
      window._bbPhotoUploads.delete(item);
      if (localUrl) { URL.revokeObjectURL(localUrl); localUrl = null; item.localUrl = null; }
      if (window.renderAllPhotos) window.renderAllPhotos();
      if (window.showToast) window.showToast(message);
    };
    let task;
    try {
      const compressed = await compressImage(file);
      if (!compressed?.size || compressed.size >= 4.9 * 1024 * 1024) throw Error('Photo preparation failed. Please retry this photo.');
      item.compressing = false;
      // Preview only the small prepared JPEG, avoiding a second full-size decode.
      localUrl = URL.createObjectURL(compressed); item.localUrl = localUrl;
      const fileRef = storageRef(storage, storagePath);
      task = uploadBytesResumable(fileRef, compressed, { contentType: 'image/jpeg' });
    } catch(error) {
      if (error.code === 'photo-unreadable') window._bbPhotoUseFiles = true;
      fail(error.message || 'The photo could not be prepared. Please retry.'); return;
    }
    task.on('state_changed',
      snapshot => {
        item.progress = Math.round(snapshot.bytesTransferred / snapshot.totalBytes * 100);
        if (window.renderAllPhotos) window.renderAllPhotos();
      },
      err => fail('Upload failed. Check your connection and retry. ' + (err.message || '')),
      async () => {
        try {
          const dlUrl = await getDownloadURL(task.snapshot.ref);
          let id;
          if (scope === 'global') {
            id = await window._bbSaveGlobalImage({ url: dlUrl, path: storagePath }, bizId);
          } else if (cid) {
            id = await window._bbSaveCampaignImage(cid, { url: dlUrl, path: storagePath }, bizId);
          }
          if (!id) throw new Error('Photo record was not saved');
          item.id = id;
          item.url = dlUrl;
          item.localUrl = dlUrl;
          item.done = true;
          if(uploadAdId && scope==='campaign' && bizId===activeBizId && cid===activeCampaignId && uploadAdId===window.BBAds?.active?.id){
            await window.BBAds.choosePhoto(item, true);
          }
          window.BBAds?.refreshImages().catch(error => window.showToast?.('Photo saved, but the photo list could not refresh. Reload to see it.'));
          item.progress = 100;
          window._bbPhotoUploads.delete(item);
          if (photoUploadMatchesView(item) && !window._bbPhotoItems.some(photo => photo === item || photo.id === id)) {
            window._bbPhotoItems.push(item);
          }
          if (localUrl && localUrl.startsWith('blob:')) URL.revokeObjectURL(localUrl);
          if (scope === 'global' && bizId === activeBizId) {
            window._globalImages = window._globalImages || [];
            window._globalImages.push({ url: dlUrl, path: storagePath, id, scope: 'global' });
          }
        } catch(e) {
          console.error('Photo save error:', e);
          fail('Photo uploaded but could not be saved. Remove it and try again.');
        }
        if (window.renderAllPhotos) window.renderAllPhotos();
      }
    );
  };

  window._bbSelectPhoto = async function(index) {
    const item = (window._bbPhotoItems || [])[index];
    if (!item || !item.done || item.deleting || window._bbFeaturedPhotoSaving) return;
    const featuredUrl = window._bbFeaturedPhotoUrl === item.url ? '' : item.url;
    const bizId = activeBizId;
    window._bbFeaturedPhotoSaving = true;
    item.selecting = true;
    if (window.renderAllPhotos) window.renderAllPhotos();
    try {
      await updateDoc(doc(db, 'users', currentUser.uid, 'businesses', bizId), { featuredPhoto: featuredUrl });
      if (activeBizId === bizId) window._bbFeaturedPhotoUrl = featuredUrl;
      window.showToast && window.showToast(featuredUrl ? '⭐ Featured photo set' : 'Photo deselected');
    } catch(e) {
      console.error('featuredPhoto save error:', e);
      window.showToast && window.showToast('Could not save your photo selection. Please try again.');
    } finally {
      window._bbFeaturedPhotoSaving = false;
      item.selecting = false;
      if (window.renderAllPhotos) window.renderAllPhotos();
    }
  };

  window._bbDeletePhoto = async function(index) {
    const items = window._bbPhotoItems || [];
    const item = items[index];
    if (!item || item.deleting || item.selecting) return;
    // Excluding from this Ad and deleting an upload are separate actions.
    if(item.scope==='campaign' && item.campaignId===activeCampaignId && window.BBAds?.active?.imageRefs?.some(image=>image.id===item.id)){
      await window.BBAds.choosePhoto(item);
      if(window.BBAds.active.imageRefs.some(image=>image.id===item.id))return;
    }
    item.deleting = true;
    if (window.renderAllPhotos) window.renderAllPhotos();
    const itemScope = item.scope || photoScope || 'campaign';
    const cid = item.campaignId || activeCampaignId;
    try {
      if (itemScope === 'global') {
        await window._bbDeleteGlobalImage(item);
      } else if (cid) {
        await window._bbDeleteCampaignImage(cid, item);
      }
    } catch(e) {
      item.deleting = false;
      if (window.renderAllPhotos) window.renderAllPhotos();
      console.error('Photo record delete error:', e);
      if (window.showToast) window.showToast('Could not remove this photo. Please try again.');
      return;
    }
    window._bbPhotoUploads.delete(item);
    if (item.localUrl?.startsWith('blob:')) URL.revokeObjectURL(item.localUrl);
    // Remove from the current grid only after the record deletion succeeds.
    const currentIndex = items.indexOf(item);
    if (currentIndex !== -1) {
      if (window._bbPhotoItems === items) {
        if (window._bbSelectedPhotoIndex === currentIndex) window._bbSelectedPhotoIndex = null;
        else if (window._bbSelectedPhotoIndex > currentIndex) window._bbSelectedPhotoIndex--;
      }
      items.splice(currentIndex, 1);
    }
    if (window.renderAllPhotos) window.renderAllPhotos();
    // Retain stored bytes, including unsuccessful uploads, for the V06 policy.
    // Complete account deletion remains responsible for removing owned storage.
    item.deleting = false;
  };

  // Live-listen for pending posts needing approval
  try {
    const { onSnapshot } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const pendingQ = query(
      collection(db, 'users', user.uid, 'businesses', activeBizId, 'pendingPosts'),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(10)
    );
    onSnapshot(pendingQ, snap => {
      const posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (window._bbSetPendingPosts) window._bbSetPendingPosts(posts);
    }, () => {}); // silently ignore permission errors (user may not have any)
  } catch(e) { console.warn('pendingPosts listener:', e.message); }

  // Load platform connection state from Firestore
  try {
    const connsSnap = await getDocs(query(
      collection(db, 'users', user.uid, 'businesses', activeBizId, 'platformConnections')
    ));
    {
      const connMap = {};
      window._bbConnections = connMap;
      connsSnap.forEach(d => { connMap[d.data().platform || d.id] = d.data(); });
      // Load saved page URLs into global map so accordion URL inputs are pre-filled
      Object.entries(connMap).forEach(([pid, data]) => {
        if (data.profileUrl) window._bbPlatformUrls[pid] = data.profileUrl;
      });
      const updatedPlatforms = PLATFORMS.map(p => {
        const conn = connMap[p.id];
        // _enabledPlatformIds (from biz doc) is authoritative.
        // Fallback chain: localStorage-restored in-memory state → conn.enabled → false
        const isEnabled = window.BBAds?.active
          ? (window.BBAds.active.platforms || []).includes(p.id)
          : _enabledPlatformIds !== null
          ? _enabledPlatformIds.includes(p.id)
          : (platforms.find(pp => pp.id === p.id)?.enabled ?? (conn ? !!conn.enabled : false));
        // Connections supply connection metadata; the loaded Ad owns copy and review state.
        return { ...p, ...platforms.find(current => current.id === p.id), enabled: isEnabled, status: (conn ? conn.status || 'idle' : p.status) };
      });
      if (window._bbSetPlatforms) window._bbSetPlatforms(updatedPlatforms);
    }
  } catch(e) {
    console.error('Platform load error:', e);
  }

  // Load recent publish history from Firestore through the shared result reader.
  await window._bbReloadHistory();
  if (document.getElementById('section-publishing')?.classList.contains('active')) void window.BBPublishing?.refresh();
});
}); // authStateReady

let historyRequest=0;
window._bbReloadHistory = async function() {
  if(!currentUser||!activeBizId)return;
  const seq=++historyRequest,bizId=activeBizId;
  const feedback=document.getElementById('history-feedback');if(feedback)feedback.textContent='Loading history…';
  try{
    const base=['users',currentUser.uid,'businesses',bizId];
    const [drafts,jobs]=await Promise.all([
      getDocs(query(collection(db,...base,'listingDrafts'),orderBy('updatedAt','desc'),limit(50))),
      getDocs(query(collection(db,...base,'publishJobs'),orderBy('createdAt','desc'),limit(100)))
    ]);
    if(seq!==historyRequest||bizId!==activeBizId)return;
    const records=jobs.docs.map(d=>({...d.data(),jobId:d.id}));
    window._bbSetHistory(window.BBLifecycleStatus.historyRows(drafts.docs.map(d=>({...d.data(),id:d.id})),records));
    if(feedback)feedback.textContent=records.length?'Showing the latest '+records.length+' destination results.':'No posting activity yet.';
  }catch(error){
    if(seq!==historyRequest||bizId!==activeBizId)return;
    if(feedback)feedback.textContent='History could not be refreshed. Tap Refresh history to retry.';
  }
};

// Fetch a listingDraft document by id
window._bbLoadDraft = async function(draftId) {
  if (!currentUser || !activeBizId || !draftId) return null;
  const ref  = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', draftId);
  const snap = await getDoc(ref);
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
};

// Reopen the existing canonical Blast without changing its status or queueing posts.
window._bbFindLatestBlast = async function(businessId, campaignId, adId, options = {}) {
  if (!currentUser || !businessId || !campaignId || !adId) throw new Error('Open a saved campaign first.');
  const rows = await getDocs(query(
    collection(db, 'users', currentUser.uid, 'businesses', businessId, 'listingDrafts'),
    where('campaignId', '==', campaignId)
  ));
  const time = v => v?.toMillis?.() || (v?.seconds ? v.seconds * 1000 : Date.parse(v) || 0);
  return rows.docs.map(row => ({...row.data(), id: row.id}))
    .filter(d => (d.adId === adId || (!d.adId && adId === 'first')) &&
      !d.scheduleAdPath && ['prepared', 'ready_to_publish', 'approved', 'completed'].includes(d.status) &&
      (options.adRevision === undefined || d.packet?.adRevision === options.adRevision))
    .sort((a, b) => (options.adRevision === undefined ? Number(b.status === 'approved') - Number(a.status === 'approved') : 0) ||
      Math.max(time(b.approvedAt), time(b.createdAt)) - Math.max(time(a.approvedAt), time(a.createdAt)))[0] || null;
};

// Update an existing listingDraft document — used by approvePlatformCopy and regeneratePlatformCopy
window._bbUpdateDraft = async function(draftId, updates) {
  if (!currentUser || !activeBizId || !draftId) throw new Error('No signed-in draft');
  const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', draftId);
  await updateDoc(ref, { ...updates, updatedAt: serverTimestamp(), revision: increment(1) });
};

// Schedule changes do not modify the frozen creative packet or its revision.
window._bbUpdateDraftSchedule = async function(draftId, schedule) {
  if (!currentUser || !activeBizId || !draftId) throw new Error('No signed-in draft');
  const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', draftId);
  await updateDoc(ref, { schedule, updatedAt: serverTimestamp() });
};

window._bbPrepareGenerationDraft = function() {
  if (!currentUser || !activeBizId) throw new Error('No signed-in business');
  if (window._currentDraftId) return window._currentDraftId;
  const key = JSON.stringify([currentUser.uid, activeBizId, activeCampaignId || '']);
  if (!window._bbPendingDraft || window._bbPendingDraft.key !== key) {
    window._bbPendingDraft = { key, ref: doc(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts')) };
  }
  return window._bbPendingDraft.ref.id;
};

window._afterAdaptation = async function(adaptedPlatforms) {
  if (!currentUser || !activeBizId) throw new Error('No signed-in business');
  const businessId = activeBizId;
  const uid = currentUser.uid;
  try {
    const adaptations = {};
    adaptedPlatforms.filter(p => p.enabled && p.adaptedContent).forEach(p => {
      adaptations[p.id] = p.adaptedContent.replace(/<br\/?>/gi, '\n');
    });
    const platformStatus = Object.fromEntries(adaptedPlatforms.filter(p=>p.enabled).map(p=>[p.id,p._reviewStatus==='approved'?'approved':p._reviewStatus==='skipped'?'excluded':'needs-review']));

    const pickupLocation=window._bbProfileGlobal?.sellerType==='personal'?{pickupArea:window.BBAds?.active?.pickupArea||'',pickupZip:window.BBAds?.active?.pickupZip||''}:{};

    // F1: If a draft already exists for this blast, update it — never create a duplicate
    const existingDraftId = window._currentDraftId;
    if (existingDraftId) {
      const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', existingDraftId);
      await updateDoc(ref, {
        ...pickupLocation,
        adaptations,
        platformStatus,
        enabledPlatforms: adaptedPlatforms.filter(p=>p.enabled).map(p=>p.id),
        lastGeneratedAt: serverTimestamp(),
        updatedAt:       serverTimestamp(),
        revision:        increment(1),
      });
      return existingDraftId;
    }

    // First generation — create a new draft
    const draftData = {
      ...pickupLocation,
      uid:          currentUser.uid,
      businessId:   activeBizId,
      adaptations,
      platformStatus,
      enabledPlatforms: adaptedPlatforms.filter(p=>p.enabled).map(p=>p.id),
      name:         document.getElementById('biz-name')?.value || '',
      category:     document.getElementById('biz-category')?.value || '',
      offer:        document.getElementById('biz-offer')?.value || '',
      price:        document.getElementById('biz-price')?.value || '',
      phone:        document.getElementById('biz-phone')?.value || '',
      address:      document.getElementById('biz-address')?.value || '',
      region:       document.getElementById('biz-region')?.value || '',
      website:      document.getElementById('biz-website')?.value || '',
      hours:        document.getElementById('biz-hours')?.value || '',
      adName:       document.getElementById('biz-ad-name')?.value || '',
      campaignContext: document.getElementById('campaign-context')?.value?.trim() || '',
      campaignId:   activeCampaignId || '',
      adId: window.BBAds?.active?.id || '',
      campaignName: activeCampaignName || '',
      status:       'draft',
      revision:     0,
      lastGeneratedAt: serverTimestamp(),
      createdAt:    serverTimestamp(),
      updatedAt:    serverTimestamp(),
    };

    const key = JSON.stringify([uid, businessId, activeCampaignId || '']);
    if (!window._bbPendingDraft || window._bbPendingDraft.key !== key) {
      window._bbPendingDraft = { key, ref: doc(collection(db, 'users', uid, 'businesses', businessId, 'listingDrafts')) };
    }
    const ref = window._bbPendingDraft.ref;
    await setDoc(ref, draftData);
    if (activeBizId !== businessId || currentUser?.uid !== uid || window._bbPendingDraft?.ref !== ref) return null;
    if (activeBizId === businessId && currentUser?.uid === uid) {
      window._currentDraftId = ref.id;
      window._bbPendingDraft = null;
    }
    return ref.id;
  } catch(e) {
    console.error('Save draft error:', e);
    throw e;
  }
};

document.addEventListener('bb:savePlatforms', async (e) => {
  if (!currentUser || !activeBizId) return;
  try {
    const plats = e.detail?.platforms || [];
    if (!plats.length) return;
    const batch = writeBatch(db);
    plats.forEach(p => {
      const ref = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'platformConnections', p.id);
      // F3: Only write connection-health fields — blast-specific enabled/status stay in listingDrafts
      batch.set(ref, {
        uid: currentUser.uid,
        businessId: activeBizId,
        platform: p.id,
        platformName: p.name,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    });
    await batch.commit();
  } catch(e) {
    console.error('savePlatforms Firestore error:', e);
  }
});

document.addEventListener('bb:addHistory', async (e) => {
  if ((window._bbUserPlan || '') === 'trial') return;
  if (!currentUser || !activeBizId) return;
  try {
    const platformName = e.detail?.platformName || '';
    await addDoc(collection(db, 'activityLogs'), {
      uid: currentUser.uid,
      businessId: activeBizId,
      draftId: window._currentDraftId || null,
      platform: platformName,
      listingName: document.getElementById('biz-name')?.value || 'Listing',
      action: 'manual_copy_paste',
      note: 'User copied listing for ' + platformName + ' (copy-paste flow).',
      createdAt: serverTimestamp(),
    });
  } catch(e) {
    console.error('addHistory activityLogs error:', e);
  }
});

document.addEventListener('bb:clearAll', async () => {
  if (!currentUser || !activeBizId) return;
  try {
    const connsSnap = await getDocs(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'platformConnections'));
    const batch = writeBatch(db);
    connsSnap.forEach(d => batch.delete(d.ref));
    await batch.commit();
  } catch(e) {
    console.error('clearAll Firestore error:', e);
  }
});

// Write manualPosted timestamp to the draft doc when user confirms a copy-paste post
document.addEventListener('bb:manualPosted', async (e) => {
  if (!currentUser || !activeBizId) return;
  const { pid, draftId, postedAt } = e.detail || {};
  if (!pid || !draftId) return;
  try {
    const draftRef = doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'listingDrafts', draftId);
    await updateDoc(draftRef, {
      [`manualPosted.${pid}`]: new Date(postedAt),
      updatedAt: serverTimestamp(),
    });
  } catch(e) { console.warn('[bb:manualPosted]', e.message); }
});

// Persist platformPrefs (dismiss/restore + lastPostedAt) to the business doc
document.addEventListener('bb:savePlatPrefs', async (e) => {
  if (!currentUser || !activeBizId) return;
  const prefs = e.detail?.prefs;
  if (!prefs) return;
  try {
    await setDoc(
      doc(db, 'users', currentUser.uid, 'businesses', activeBizId),
      { platformPrefs: prefs, updatedAt: serverTimestamp() },
      { merge: true }
    );
  } catch(e) { console.warn('[bb:savePlatPrefs]', e.message); }
});

// Save a platform's page URL to Firestore — called from URL input onblur
window.savePlatformUrl = async function(pid, url) {
  const report=message=>{const feedback=document.getElementById('qp-url-feedback-'+pid);if(feedback)feedback.textContent=message;else showToast(message);};
  if (!currentUser || !activeBizId) { report('Sign in before saving this link.'); return; }
  report('Saving link…');
  try {
    await setDoc(
      doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'platformConnections', pid),
      { uid: currentUser.uid, businessId: activeBizId, platform: pid, profileUrl: url, updatedAt: serverTimestamp() },
      { merge: true }
    );
    window._bbPlatformUrls[pid] = url;
    report('Posting link saved.');
  } catch(e) { report('Link was not saved. Your entry is still here — tap Save to retry.'); }
};

const origSaveProfile = window.saveProfile;
let _saveProfileTimer = null;
window.saveProfile = function() {
  if ((window._bbUserPlan || '') === 'trial') {
    origSaveProfile && origSaveProfile();
    if (window._flashTrialBanner) window._flashTrialBanner();
    return;
  }
  origSaveProfile && origSaveProfile(); // sync: updates in-memory profile + UI immediately
  if (window._showProfileSaved) window._showProfileSaved('Saving…');
  clearTimeout(_saveProfileTimer);
  _saveProfileTimer = setTimeout(async () => {
  if (!currentUser || !activeBizId) return;
  try {
    // Validate email and phone before persisting — skip invalid non-empty values
    const _emailVal = profile.email || '';
    const _phoneVal = profile.phone || '';
    const _emailOk  = !_emailVal || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(_emailVal);
    const _phoneOk  = !_phoneVal || _phoneVal.replace(/\D/g,'').length >= 7;
    const _emailErr = document.getElementById('profile-email-err');
    const _phoneErr = document.getElementById('profile-phone-err');
    if (_emailErr) _emailErr.textContent = _emailOk ? '' : 'That doesn\u2019t look like a valid email address';
    if (_phoneErr) _phoneErr.textContent = _phoneOk ? '' : 'Please enter at least 7 digits';
    await setDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId), {
      // Never overwrite saved fields with blank — only write a field if it has a value
      ...(profile.name      ? { businessName: profile.name, name: profile.name } : {}),
      ...BBSetup.nameParts(profile),
      ownerRole: profile.sellerType==='personal'?'':profile.ownerRole || 'owner',
      ...(profile.category  ? { category:    profile.category }  : {}),
      ...(_phoneOk && profile.phone ? { phone: profile.phone } : {}),
      ...(_emailOk && profile.email ? { email: profile.email } : {}),
      ...(profile.street   ? { street:       profile.street }   : {}),
      ...(profile.city     ? { city:         profile.city }     : {}),
      ...(profile.state    ? { state:        profile.state }    : {}),
      ...(profile.zip      ? { zip:          profile.zip }      : {}),
      ...(profile.address  ? { address:      profile.address }  : {}),
      ...(profile.website  ? { website:      profile.website }  : {}),
      ...(profile.hours    ? { hours:        profile.hours }    : {}),
      locationType:   profile.locationType || 'physical',
      region:         profile.region || '',
      tone:           profile.tone   || 'friendly',
      updatedAt:      serverTimestamp(),
    }, { merge: true });
    const savedBusiness = (window.BUSINESSES || []).find(b => b.id === activeBizId);
    if (savedBusiness && profile.name) {
      savedBusiness.businessName = profile.name;
      savedBusiness.name = profile.name;
      renderSwitcherBar();
    }
    if (window._showProfileSaved) window._showProfileSaved('Saved ✓');
  } catch(e) {
    console.error('saveProfile Firestore error:', e);
  }
  }, 1000); // debounce: write to Firestore 1 s after last keystroke
};

window._savePlatformCatsToFirestore = async function(cats) {
  if (!currentUser || !activeBizId) return;
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId), {
      platformCats: cats,
      updatedAt:    serverTimestamp(),
    }, { merge: true });
  } catch(e) {
    console.error('savePlatformCats Firestore error:', e);
  }
};

window._saveScheduleToFirestore = async function(sched) {
  if (!currentUser || !activeBizId) return;
  try {
    const payload = {
      enabled:              sched.enabled,
      frequency:            sched.frequency,
      dayOfWeek:            sched.dayOfWeek,
      dayOfMonth:           sched.dayOfMonth,
      timeSlot:             sched.timeSlot,
      timezone:             sched.timezone,
      requireApproval:      !!sched.requireApproval,
      activeCampaignId:     sched.activeCampaignId   || '',
      activeCampaignName:   sched.activeCampaignName || '',
      updatedAt:            serverTimestamp(),
    };
    if (sched.nextRunAt) {
      payload.nextRunAt = new Date(sched.nextRunAt);
    } else {
      payload.nextRunAt = null;
    }
    await setDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId), {
      postingSchedule: payload,
    }, { merge: true });
  } catch(e) {
    console.error('saveSchedule Firestore error:', e);
  }
};
