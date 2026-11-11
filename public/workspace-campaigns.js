// ══════════════════════════════════════════════════════════
// Campaign AI Chat — State + Helpers
// ══════════════════════════════════════════════════════════
;(function(){
const CC_CF = 'https://us-central1-blastybiz-9523e.cloudfunctions.net/chatCampaign';

let ccPhase = 'scripted'; // 'scripted'|'ai'|'done'
let ccIdx = 0;
let ccWaiting = false;
const ccCol = { campaignName:'', offer:'', price:'', pickup:'', dates:'' };
let ccHistory = [];

const $cc = id => document.getElementById(id);
const ccMsgs = () => $cc('cc-messages');

function ccAddMsg(role, text) {
  const d = document.createElement('div');
  d.className = 'cc-msg cc-' + role;
  d.textContent = text;
  ccMsgs().appendChild(d);
  ccMsgs().scrollTop = ccMsgs().scrollHeight;
}
function ccShowTyping() {
  const d = document.createElement('div');
  d.className = 'cc-typing'; d.id = 'cc-typing';
  d.innerHTML = '<span></span><span></span><span></span>';
  ccMsgs().appendChild(d);
  ccMsgs().scrollTop = ccMsgs().scrollHeight;
}
function ccHideTyping() { $cc('cc-typing')?.remove(); }
function ccSetProgress(p) { $cc('cc-progress-fill').style.width = p + '%'; }
function ccSetLabel(t)    { $cc('cc-label').textContent = t || ''; }
function ccSetSkip(show)  { $cc('camp-skip-btn').style.display = show ? 'inline' : 'none'; }
function ccSetOpts(opts) {
  const el = $cc('cc-options'); el.innerHTML = '';
  opts.forEach(o => {
    const b = document.createElement('button');
    b.className = 'cc-opt-btn'; b.textContent = o.label;
    b.onclick = () => ccPickOpt(o.value, o.label);
    el.appendChild(b);
  });
  document.querySelector('.cc-input-row').style.display = 'none';
}
function ccClearOpts() { $cc('cc-options').innerHTML = ''; document.querySelector('.cc-input-row').style.display = 'flex'; }
function ccSetWaiting(w) {
  ccWaiting = w;
  $cc('camp-send-btn').disabled = w;
  $cc('camp-chat-input').disabled = w;
  if (!w) { $cc('camp-chat-input').focus(); }
}

// ── Scripted Steps ────────────────────────────────────────
let CC_STEPS = BBBlasty.campaignSteps(ccCol);

function ccAdvance() {
  if(ccIdx===0)CC_STEPS=BBBlasty.campaignSteps(ccCol);
  if (ccIdx >= CC_STEPS.length) { ccStartAI(); return; }
  const step = CC_STEPS[ccIdx];
  const msg  = typeof step.msg === 'function' ? step.msg() : step.msg;
  const pct  = Math.round(((ccIdx + 1) / (CC_STEPS.length + 3)) * 60);

  setTimeout(() => {
    ccShowTyping();
    setTimeout(() => {
      ccHideTyping();
      ccAddMsg('ai', msg);
      ccSetProgress(pct);
      ccSetLabel(step.label || 'Campaign Details');
      ccClearOpts();
      const inp = $cc('camp-chat-input');
      inp.value = '';
      const ph = typeof step.placeholder === 'function' ? step.placeholder() : (step.placeholder || 'Type here…');
      inp.placeholder = ph;
      inp.type = 'text';
      const isOpt = typeof step.optional === 'function' ? step.optional() : !!step.optional;
      ccSetSkip(isOpt);
      inp.focus();
    }, 500);
  }, ccIdx === 0 ? 300 : 0);
}

function ccPickOpt(value, label) {
  const step = CC_STEPS[ccIdx];
  const field = typeof step.field === 'function' ? step.field() : step.field;
  ccCol[field] = value;
  ccAddMsg('user', label);
  ccClearOpts(); ccSetSkip(false);
  ccIdx++;
  ccAdvance();
}

function campSkip() {
  if (ccWaiting) return;
  if (ccPhase === 'ai' && (window._bbProfileGlobal||{}).sellerType==='personal') {
    ccPhase='done';
    ccSetSkip(false);
    ccCreateCampaign({campaignMemory:[ccCol.campaignName,ccCol.offer,ccCol.price,ccCol.pickup,ccCol.dates,...ccHistory.filter(m=>m.role==='user').map(m=>m.content)].filter(Boolean).join('\n')});
    return;
  }
  const step = CC_STEPS[ccIdx];
  if (!step || !(typeof step.optional==='function'?step.optional():step.optional)) return;
  ccAddMsg('user', '(skipped)');
  ccSetSkip(false);
  ccIdx++;
  ccAdvance();
}

window.campSkip = campSkip;

window.campSend = function() {
  if (ccWaiting) return;
  const inp = $cc('camp-chat-input');
  const val = inp.value.trim();

  if (ccPhase === 'scripted') {
    const step = CC_STEPS[ccIdx];
    if (!val) { const isOpt = typeof step?.optional === 'function' ? step.optional() : !!step?.optional; if (isOpt) { campSkip(); } return; }
    const field = typeof step?.field === 'function' ? step.field() : step?.field;
    if (field) ccCol[field] = val;
    ccAddMsg('user', val);
    inp.value = ''; ccSetSkip(false);
    ccIdx++;
    ccAdvance();

  } else if (ccPhase === 'ai') {
    if (!val) return;
    ccAddMsg('user', val);
    inp.value = '';
    ccHistory.push({ role: 'user', content: val });
    ccCallCF();
  }
};

// ── AI Phase ──────────────────────────────────────────────
function ccStartAI() {
  ccPhase = 'ai';
  const personal=(window._bbProfileGlobal||{}).sellerType==='personal';
  ccSetLabel(personal?'Anything else? (optional)':'Tell AI About This Campaign');
  ccSetProgress(65);

  const opening = personal ? 'Anything else you want buyers to know? You can skip this and save with the details you have already provided.' : `Great${ccCol.campaignName ? ' — "' + ccCol.campaignName + '"' : ''}! Now tell me more. What should customers get excited about? What makes this campaign special or different from your usual marketing?`;
  ccShowTyping();
  setTimeout(() => {
    ccHideTyping();
    ccAddMsg('ai', opening);
    ccHistory.push({ role: 'assistant', content: opening });
    ccClearOpts();
    $cc('camp-chat-input').placeholder = personal?'Optional extra item details…':'Tell me about this campaign…';
    ccSetSkip(personal);
    $cc('camp-chat-input').focus();
  }, 800);
}

async function ccCallCF() {
  const user = window.currentUser || window._blastyUser;
  if (!user) return;
  ccSetWaiting(true);
  ccShowTyping();
  try {
    const token = await user.getIdToken();
    const resp  = await fetch(CC_CF, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        businessId: window.activeBizId || null,
        campaignId: activeCampaignId || null,
        conversationHistory: ccHistory,
        businessProfile: {
          sellerType: (window._bbProfileGlobal || {}).sellerType || 'business',
          name:         (window._bbProfileGlobal || {}).name || '',
          globalMemory: window._globalMemory || '',
          description:  (window._bbProfileGlobal || {}).description || '',
        },
        collectedData: {
          campaignName: ccCol.campaignName,
          offer:        ccCol.offer,
          price:        ccCol.price,
          dates:        ccCol.dates,
          pickup:       ccCol.pickup,
        }
      })
    });
    ccHideTyping();
    if (!resp.ok) {
      const failure = await resp.json().catch(() => ({}));
      throw new Error(failure.error || 'Campaign AI could not respond. Please try again.');
    }
    const data = await resp.json();

    ccAddMsg('ai', data.message);
    ccHistory.push({ role: 'assistant', content: data.message });

    if (data.done) {
      ccPhase = 'done';
      ccSetProgress(95);
      ccSetLabel('Saving Campaign…');
      document.querySelector('.cc-input-row').style.display = 'none';
      ccSetSkip(false);
      setTimeout(() => ccCreateCampaign(data), 1200);
    } else {
      ccSetWaiting(false);
    }
  } catch(e) {
    ccHideTyping();
    ccAddMsg('ai', e.message || 'Campaign AI could not respond. Your answers are still here.');
    ccSetWaiting(false);
  }
}

let ccCampaignSaving = false;
let ccPendingCampaign = null;
async function ccCreateCampaign(aiData) {
  if (ccCampaignSaving) return;
  const businessId = window.activeBizId;
  if (ccPendingCampaign && ccPendingCampaign.businessId !== businessId) {
    ccAddMsg('ai', 'Select the original business before retrying this campaign save.');
    return;
  }
  const name = ccCol.campaignName || ('Campaign ' + new Date().toLocaleDateString());
  if (!ccPendingCampaign || ccPendingCampaign.businessId !== businessId) ccPendingCampaign = { businessId, id: 'c_' + crypto.randomUUID() };
  const id = ccPendingCampaign.id;
  const now  = new Date().toISOString();
  const newCampaign = {
    id, name,
    createdAt:       now,
    lastUsedAt:      '',
    photos:          [],
    offer:           ccCol.offer || '',
    adName:          '',
    price:           ccCol.price || '',
    campaignStory:   ccCol.offer || '',
    campaignMemory:  aiData.campaignMemory || '',
    factoids:        [],
    platformHistory: {},
  };

  ccCampaignSaving = true;
  $cc('cc-options').innerHTML = '';
  try {
    if (!window._bbSaveCampaigns) throw new Error('Saving is not ready yet');
    await window._bbSaveCampaigns([newCampaign]);
    if(window.BBAds)await window.BBAds.api('create',{businessId,campaignId:id,adId:'first',requestId:'first',creative:{name:name+' — First Ad',offer:ccCol.offer||'',price:ccCol.price||'',context:'',platforms:platforms.filter(p=>p.enabled).map(p=>p.id)}});
  } catch(e) {
    ccSetLabel('Campaign not saved');
    ccAddMsg('ai', 'Your campaign brief is still here. Retry saving it below.');
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'cc-opt-btn'; retry.textContent = 'Retry save';
    retry.onclick = () => ccCreateCampaign(aiData);
    $cc('cc-options').appendChild(retry);
    return;
  } finally { ccCampaignSaving = false; }
  ccPendingCampaign = null;
  if (window.activeBizId !== businessId) return;
  campaigns = campaigns.filter(c => c.id !== id).concat(newCampaign);
  _sortCampaigns();
  activeCampaignId = id;
  activeCampaignName = name;

  ccSetProgress(100);
  ccSetLabel('Campaign Created! 🎉');
  ccAddMsg('ai', `"${name}" is ready to blast! 🚀`);

  setTimeout(async () => {
    closeCampaignChat();
    if (typeof renderCampaignChips === 'function') renderCampaignChips();
    if (typeof document.getElementById('new-campaign-row')?.classList?.add === 'function') document.getElementById('new-campaign-row').classList.add('hidden');
    document.getElementById('campaign-content')?.classList.remove('hidden');
    const ctxEl = document.getElementById('campaign-context');
    await selectCampaign(id, name);
    openCampaignPhotos();
    if (typeof showToast === 'function') showToast('Campaign "' + name + '" created');
  }, 1500);
}

// ── Public API ────────────────────────────────────────────
window.openCampaignChat = function() {
  if (ccPendingCampaign || ccCampaignSaving) {
    $cc('camp-chat-modal').classList.add('open');
    document.body.style.overflow = 'hidden';
    return;
  }
  const nameInput = document.getElementById('new-campaign-input');
  const prefilledName = nameInput?.value?.trim() || '';
  ccCol.campaignName = prefilledName;
  ccCol.offer = ''; ccCol.price = ''; ccCol.pickup = ''; ccCol.dates = '';
  ccPhase = 'scripted'; ccIdx = 0; ccWaiting = false; ccHistory = [];
  $cc('cc-messages').innerHTML = '';
  $cc('cc-options').innerHTML = '';
  $cc('cc-progress-fill').style.width = '0%';
  document.querySelector('.cc-input-row').style.display = 'flex';
  $cc('camp-chat-input').value = '';
  $cc('camp-send-btn').disabled = false;
  $cc('camp-chat-input').disabled = false;
  document.getElementById('new-campaign-row')?.classList.add('hidden');
  document.getElementById('campaign-content')?.classList.add('hidden');
  $cc('camp-chat-modal').classList.add('open');
  document.body.style.overflow = 'hidden';
  ccAdvance();
};

window.closeCampaignChat = function() {
  $cc('camp-chat-modal').classList.remove('open');
  document.body.style.overflow = '';
  if (window.activeCampaignId) {
    document.getElementById('campaign-content')?.classList.remove('hidden');
  }
};

// ══════════════════════════════════════════
// STORY TAB
// ══════════════════════════════════════════

// Track whether the first free regen of the current draft has been used.
// Set to false at the start of each new generation run; set to true after any regen.
window._bbDraftFreeRegenUsed = false;

// ── _bbExtractBizContext ──────────────────────────────────────────────────────
// Calls extractBizContext CF with either 'google' or 'url' as source,
// then pre-fills the five STORY_FIELDS textareas with AI-drafted text.
window._bbExtractBizContext = async function(source) {
  const statusEl = document.getElementById('story-extract-status');
  const extractBtn = document.getElementById('story-extract-btn');
  const googleBtn  = document.getElementById('story-extract-google-btn');

  const setStatus = (msg, color) => {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = color || 'var(--muted,#888)';
    statusEl.style.display = msg ? 'block' : 'none';
  };

  const urlInput = document.getElementById('story-extract-url');
  const sourceUrl = source === 'url' ? urlInput?.value?.trim() : '';

  if (source === 'url' && !sourceUrl) return;

  // Loading state
  setStatus('⏳ Reading your site…', 'var(--muted,#888)');
  if (extractBtn) { extractBtn.disabled = true; extractBtn.textContent = '⏳ Working…'; }
  if (googleBtn)  { googleBtn.disabled = true; }

  try {
    const data = await BBBusinessImport.extract({getToken:()=>window._bbGetToken?.(),bizId:activeBizId,sourceUrl:source==='url'?sourceUrl:undefined,source:source==='google'?'google':undefined});

    // Pre-fill only fields that AI returned a value for; preserve existing content otherwise
    let filled = 0;
    STORY_FIELDS.forEach(f => {
      const val = data.aiContext[f.key];
      if (!val) return;
      const el = document.getElementById(f.id);
      if (!el) return;
      el.value = val;
      // Update char count
      const cntId = 'cnt-' + f.id.replace('ctx-', '');
      const cntEl = document.getElementById(cntId);
      if (cntEl) cntEl.textContent = val.length;
      filled++;
    });

    // Enable save button
    const saveBtn = document.getElementById('story-btn-save');
    if (saveBtn) saveBtn.disabled = false;

    setStatus(`✅ AI drafted ${filled} field${filled !== 1 ? 's' : ''} from ${data.source || 'the source'}. Review and edit before saving.`, 'var(--green,#0c6)');
  } catch(e) {
    console.error('extractBizContext error:', e);
    setStatus('❌ ' + (e.message || 'Network error — try again'), 'var(--red,#e05)');
  } finally {
    if (extractBtn) { extractBtn.disabled = !urlInput?.value?.trim(); extractBtn.textContent = 'Extract ✨'; }
    if (googleBtn)  { googleBtn.disabled = false; }
  }
};

const STORY_FIELDS = [
  { id: 'ctx-story',     key: 'story' },
  { id: 'ctx-different', key: 'different' },
  { id: 'ctx-awards',    key: 'awards' },
  { id: 'ctx-customer',  key: 'customer' },
  { id: 'ctx-other',     key: 'other' },
];

let _storyLoaded = false;

window._bbLoadStory = async function() {
  if (_storyLoaded) return;
  try {
    // Check Google connection to decide whether to show the Google extract button
    try {
      const gConnSnap = await getDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'platformConnections', 'google'));
      const gRow = document.getElementById('story-extract-google-row');
      if (gRow) gRow.style.display = (gConnSnap.exists() && gConnSnap.data().status === 'connected') ? 'block' : 'none';
    } catch(_) { /* non-fatal — hide google row silently */ }

    const bizSnap = await getDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId));
    if (bizSnap.exists()) {
      const biz = bizSnap.data();
      // Merge top-level legacy fields with aiContext; aiContext wins on conflict
      const ctx = { story:'', different:'', awards:'', customer:'', other:'',
                    ...biz, ...(biz.aiContext || {}) };
      STORY_FIELDS.forEach(f => {
        const el = document.getElementById(f.id);
        if (!el) return;
        if (ctx[f.key]) {
          el.value = ctx[f.key];
          const cntKey = 'cnt-' + f.id.replace('ctx-', '');
          const cntEl = document.getElementById(cntKey);
          if (cntEl) cntEl.textContent = el.value.length;
        }
      });
      const btn = document.getElementById('story-btn-save');
      if (btn) btn.disabled = false;
    }
    const plan = userPlan || 'starter';
    document.getElementById('doc-library-section').style.display = 'block';
    document.getElementById('doc-library-locked').style.display = 'none';
    _bbLoadLibraryDocs();
    _storyLoaded = true;
  } catch(e) {
    console.error('loadStory:', e);
    // Do NOT set _storyLoaded — allows retry on next tab click
  }
};

window.saveStory = async function(continueToCreate = false) {
  if (!activeBizId) { showToast('No active business found'); return; }
  const savedBizId = activeBizId;
  const btn = document.getElementById('story-btn-save');
  const status = document.getElementById('story-save-status');
  const idleLabel = btn?.textContent || 'Save & Continue →';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  const aiContext = {};
  STORY_FIELDS.forEach(f => {
    const el = document.getElementById(f.id);
    if (el) aiContext[f.key] = el.value.trim();
  });
  try {
    await setDoc(doc(db, 'users', currentUser.uid, 'businesses', savedBizId), { aiContext }, { merge: true });
    if (btn) { btn.disabled = false; btn.textContent = idleLabel; }
    if (status) { status.textContent = '✓ Saved — AI will use this next time'; status.style.opacity = '1'; setTimeout(() => { status.style.opacity = '0'; }, 3000); }
    showToast('Business story saved');
    if (continueToCreate && activeBizId === savedBizId) showTab('create');
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = idleLabel; }
    showToast('Save failed — try again');
  }
};

async function _bbLoadLibraryDocs() {
  const list = document.getElementById('doc-list');
  if (!list || !activeBizId) return;
  try {
    const snap = await getDocs(query(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'documents'), orderBy('uploadedAt', 'desc')));
    if (snap.empty) { list.innerHTML = '<p class="bb-style-b0225b5a">No documents yet.</p>'; return; }
    const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    list.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const chars = (data.extractedText || '').length;
      const safeText = (data.extractedText || '').replace(/\\/g,'\\\\').replace(/`/g,'\\`');
      return `<div class="bb-style-e60425bd">
        <div class="bb-style-60550a13">
          <div class="bb-style-3922d326">
            <div class="bb-style-56d73af4">${esc(data.name)}</div>
            <div class="bb-style-fc85ba5a">${chars.toLocaleString()} chars extracted</div>
          </div>
          <div class="bb-style-b71a0331">
            <button type="button" onclick="window.viewLibraryDoc('${esc(data.name)}',\`${safeText}\`)" class="bb-style-e09fae98">View</button>
            <label class="bb-style-cb97b214">Replace<input type="file" accept=".txt,.pdf" class="bb-style-6b99de8b" onchange="handleDocUpload(event,'${d.id}','${esc(data.name)}')" /></label>
            <button type="button" onclick="window.deleteLibraryDoc('${d.id}')" class="bb-style-d58f4488">Remove</button>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { if (list) list.innerHTML = '<p class="bb-style-b0225b5a">Could not load documents.</p>'; }
}

window.viewLibraryDoc = function(name, text) {
  document.getElementById('doc-modal-title').textContent = name;
  document.getElementById('doc-modal-text').value = text;
  document.getElementById('doc-modal').style.display = 'block';
  document.body.style.overflow = 'hidden';
};

window.deleteLibraryDoc = async function(docId) {
  if (!confirm('Remove this document from your Business Library?')) return;
  try {
    await deleteDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'documents', docId));
    _bbLoadLibraryDocs();
    showToast('Document removed');
  } catch(e) { showToast('Remove failed — try again'); }
};

window.handleDocUpload = async function(evt, replaceDocId, replaceDocName) {
  const file = evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  const status = document.getElementById('doc-upload-status');
  const maxBytes = 500 * 1024;
  if (file.size > maxBytes) { status.textContent = '❌ File too large (max 500 KB)'; return; }
  status.textContent = '⏳ Extracting text…';
  try {
    let extractedText;
    if (file.name.toLowerCase().endsWith('.txt')) {
      extractedText = await new Promise((res, rej) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.onerror = rej; r.readAsText(file); });
    } else if (file.name.toLowerCase().endsWith('.pdf')) {
      const pdfLib = window.pdfjsLib;
      if (!pdfLib) throw new Error('PDF support unavailable — try a .txt file');
      pdfLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const pdf = await pdfLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = [];
      for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const c = await pg.getTextContent(); pages.push(c.items.map(x=>x.str).join(' ')); }
      extractedText = pages.join('\n');
    } else { throw new Error('Only .txt and .pdf files are supported'); }
    extractedText = extractedText.trim();
    if (!extractedText) { status.textContent = '❌ No text found in this file'; return; }
    if (extractedText.length > 20000) extractedText = extractedText.slice(0, 20000) + '\n[truncated]';
    status.textContent = '💾 Saving…';
    if (replaceDocId) {
      await updateDoc(doc(db, 'users', currentUser.uid, 'businesses', activeBizId, 'documents', replaceDocId), { name: file.name, extractedText, uploadedAt: new Date(), bytes: file.size });
      status.textContent = `✅ Replaced with "${file.name}"`;
    } else {
      await addDoc(collection(db, 'users', currentUser.uid, 'businesses', activeBizId, 'documents'), { name: file.name, extractedText, uploadedAt: new Date(), bytes: file.size });
      status.textContent = '✅ Document saved to Business Library';
    }
    _bbLoadLibraryDocs();
  } catch(e) { status.textContent = '❌ ' + e.message; }
};

// ══════════════════════════════════════════
// ACCOUNT TAB
// ══════════════════════════════════════════
const CF_BASE = 'https://us-central1-blastybiz-9523e.cloudfunctions.net';
let _acctLoaded = false;

window._bbLoadAccount = async function() {
  if (_acctLoaded) return;
  try {
    const emailEl = document.getElementById('acct-email');
    if (emailEl) emailEl.textContent = currentUser.email || '—';

    try {
      const {isAdmin} = await import('./firebase-init-v2.js?v=20261111-cleanup');
      const c = document.getElementById('acct-admin-card');
      if (c) c.style.display = await isAdmin(currentUser) ? 'block' : 'none';
    } catch(_) {}

    const userSnap = await getDoc(doc(db, 'users', currentUser.uid));
    const userData = userSnap.exists() ? userSnap.data() : {};
    const plan = userData.plan || 'starter';
    userPlan = plan;           // update module-scoped var (used by Story tab)
    window.userPlan = plan;    // keep global in sync for legacy callers

    const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
    const planEl = document.getElementById('acct-plan-label'); if (planEl) planEl.textContent = planLabel;

    const billingBtn = document.getElementById('acct-billing-btn');
    if (billingBtn) billingBtn.textContent = plan === 'starter' ? 'Upgrade Plan' : 'Manage Subscription';

    _acctLoaded = true;
  } catch(e) {
    console.error('loadAccount:', e);
    // Do NOT set _acctLoaded — allows retry on next tab click
  }
};

window.handleBilling = async function() {
  window.location.href = (window.userPlan || 'starter') === 'starter'
    ? 'BlastyBiz-Choose-Plan.html' : 'BlastyBiz-Account.html?billing=1';
};

window.confirmDeleteAccount = async function() {
  const btn = document.getElementById('delete-confirm-btn');
  const errEl = document.getElementById('delete-error');
  if (btn) { btn.textContent = 'Deleting…'; btn.disabled = true; }
  if (errEl) errEl.style.display = 'none';
  try {
    const idToken = await currentUser.getIdToken();
    const r = await fetch(`${CF_BASE}/deleteAccount`, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${idToken}`}, body: JSON.stringify({}) });
    const data = await r.json();
    if (data.success) {
      // session.js owns the canonical key list — clearing it stops a deleted
      // account's cached profile from surviving on a shared device.
      if (window._bbClearStorage) window._bbClearStorage();
      // The account is already gone server-side, so a failed sign-out must not
      // strand the user on this page.
      try { await window._bbAuthSignOut(); } catch (_) {}
      window.location.href = 'BlastyBiz-Home.html';
    }
    else {
      if (errEl) { errEl.textContent = data.error || 'Delete failed. Please try again.'; errEl.style.display = 'block'; }
      if (btn) { btn.textContent = 'Delete Everything'; btn.disabled = false; }
    }
  } catch(e) {
    if (errEl) { errEl.textContent = 'Something went wrong. Please try again.'; errEl.style.display = 'block'; }
    if (btn) { btn.textContent = 'Delete Everything'; btn.disabled = false; }
  }
};

})();
