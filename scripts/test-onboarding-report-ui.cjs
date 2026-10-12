'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../public', file), 'utf8');
const populated = { totalUsers: 4, totalNotOnboarded: 3, totalStuck: 3, asOf: '2026-10-12T12:00:00.000Z',
  steps: [{ stepIndex: 0, label: 'No saved business profile', count: 2 }, { stepIndex: 1, label: 'Saved setup unfinished', count: 1 }] };
const empty = { ...populated, steps: [], totalNotOnboarded: 0, totalStuck: 0 };
const details = { ...populated, stepIndex: 1, users: [{ uid: '<uid>', email: '<img src=x onerror=alert(1)>', createdAt: null }] };
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (body, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body });
let checks = 0;
function ok(condition, message) { assert(condition, message); checks++; }
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function setup(name) {
  const html = read(name), dom = new JSDOM(html, { url: 'https://fixture.invalid/' + name + '#onboarding-funnel', runScripts: 'outside-only' });
  const w = dom.window;
  w.auth = { currentUser: { uid: 'admin', getIdToken: async () => 'fixture' } };
  w.CF_BASE = 'https://fixture.invalid';
  const calls = [], authListeners = [];
  let result = reply(populated);
  w.fetch = async (...args) => { calls.push(args); return typeof result === 'function' ? result(...args) : result; };
  w.onAuthStateChanged = (_auth, fn) => authListeners.push(fn);
  w.loadAdminEmails = () => {}; w.loadMascotSetting = () => {};
  w.eval(read('escape-utils.js')); w._esc = w.escHtml;
  w.eval(read('onboarding-report.js'));
  const start = name.includes('Operate') ? '// ── Onboarding Funnel' : '  // ── Onboarding funnel widget';
  const end = name.includes('Operate') ? '\n</script>' : '  // ── Remaining admin dashboard';
  w.eval(html.slice(html.indexOf(start), html.indexOf(end, html.indexOf(start))));
  return { w, dom, calls, set: value => { result = value; }, node: id => w.document.getElementById(id),
    auth: user => { w.auth.currentUser = user; for (const fn of authListeners) fn(user); } };
}
async function operate() {
  const e = setup('BlastyBiz-Admin-Operate.html'), { w, node } = e;
  const pending = deferred(); e.set(() => pending.promise);
  const first = w.loadOnboardingFunnel(); await tick();
  ok(node('funnel-status').textContent === 'Loading…' && node('funnel-refresh').disabled, 'summary loading state');
  ok(w.document.querySelector('#onboarding-funnel .op-card-body').classList.contains('open'), 'linked report opens');
  pending.resolve(reply(populated)); await first;
  ok(node('funnel-chart').querySelectorAll('button[data-step]').length === 2, 'populated rows are accessible real buttons');
  ok(node('funnel-meta').textContent.includes('3 incomplete accounts of 4') && !node('funnel-meta').textContent.includes('Invalid Date'), 'count and server date');
  e.set(reply(details)); node('funnel-chart').querySelector('[data-step="1"]').click(); await tick();
  ok(node('funnel-detail').textContent.includes('<img src=x onerror=alert(1)>') && !node('funnel-detail').querySelector('img'), 'detail fields escaped');
  ok(node('funnel-detail').textContent.includes('Unknown') && !node('funnel-detail').textContent.includes('Stuck for'), 'unknown date and no fabricated inactivity');
  ok(node('funnel-detail').querySelector('button').disabled, 'unsupported reminder remains visibly unavailable');
  e.set(reply({})); await w.loadOnboardingFunnel();
  ok(node('funnel-status').textContent.includes('unavailable') && !node('funnel-chart').textContent && !node('funnel-meta').textContent && !node('funnel-detail').textContent, 'malformed refresh clears previous results');
  ok(!node('funnel-refresh').disabled, 'retry available after malformed response');
  e.set(reply(empty)); node('funnel-refresh').click(); await tick();
  ok(node('funnel-chart').textContent.includes('No incomplete') && node('funnel-status').style.color !== 'rgb(185, 28, 28)', 'legitimate empty and error-style reset');
  e.set(reply({ ...empty, totalUsers: 0 })); await w.loadOnboardingFunnel();
  ok(node('funnel-chart').textContent.includes('No accounts'), 'no accounts differs from completed accounts');
  for (const failure of [reply({ error: 'offline' }, false), { ok: true, json: async () => { throw Error('non-JSON'); } }, () => { throw Error('network'); }]) {
    e.set(failure); await w.loadOnboardingFunnel();
    ok(node('funnel-status').textContent.includes('unavailable') && !node('funnel-meta').textContent, 'HTTP/JSON/network error is unavailable');
  }
  const older = deferred(); e.set(() => older.promise); const oldLoad = w.loadOnboardingFunnel(); await tick();
  e.set(reply(populated)); await w.loadOnboardingFunnel(); older.resolve(reply(empty)); await oldLoad;
  ok(node('funnel-chart').querySelectorAll('[data-step]').length === 2, 'older summary cannot overwrite newer load');
  const closed = deferred(); e.set(() => closed.promise); const loadDetail = w.toggleStepUsers(1, 'Saved setup unfinished'); await tick();
  await w.toggleStepUsers(1, 'Saved setup unfinished'); closed.resolve(reply(details)); await loadDetail;
  ok(node('funnel-detail').style.display === 'none' && !node('funnel-detail').textContent, 'close invalidates pending detail');
  const switched = deferred(); e.set(() => switched.promise); const oldDetail = w.toggleStepUsers(1, 'Saved setup unfinished'); await tick();
  const group0 = { ...populated, stepIndex: 0, users: [{ uid: 'a', email: 'a@example.invalid', createdAt: null }, { uid: 'b', email: '', createdAt: null }] };
  e.set(reply(group0)); await w.toggleStepUsers(0, 'No saved business profile'); switched.resolve(reply(details)); await oldDetail;
  ok(node('funnel-detail').textContent.includes('a@example.invalid') && !node('funnel-detail').textContent.includes('<img'), 'switch ignores older detail');
  const refreshed = deferred(); e.set(() => refreshed.promise); const staleDetail = w.toggleStepUsers(1, 'Saved setup unfinished'); await tick();
  e.set(reply(empty)); await w.loadOnboardingFunnel(); refreshed.resolve(reply(details)); await staleDetail;
  ok(node('funnel-detail').style.display === 'none' && !node('funnel-detail').textContent, 'summary refresh invalidates detail');
  e.set(reply(populated)); await w.loadOnboardingFunnel(); e.set(reply({ ...details, users: undefined }));
  await w.toggleStepUsers(1, 'Saved setup unfinished');
  ok(node('funnel-detail').textContent.includes('unavailable') && !node('funnel-detail').textContent.includes('No users'), 'malformed detail is not an empty group');
  await w.toggleStepUsers(1, 'Saved setup unfinished'); e.set(reply(details)); await w.toggleStepUsers(1, 'Saved setup unfinished');
  ok(node('funnel-detail').textContent.includes('<uid>'), 'close/reopen retries detail successfully');
  const signedOut = deferred(); await w.toggleStepUsers(1, 'Saved setup unfinished'); e.set(() => signedOut.promise);
  const privateDetail = w.toggleStepUsers(1, 'Saved setup unfinished'); await tick(); e.auth(null); signedOut.resolve(reply(details)); await privateDetail;
  ok(!node('funnel-chart').textContent && !node('funnel-meta').textContent && !node('funnel-detail').textContent && node('funnel-refresh').disabled, 'auth loss clears and invalidates private detail');
  ok(e.calls.every(([, options]) => !options.method || options.method === 'GET'), 'report interactions send no email or mutation');
  e.dom.window.close();
}
async function widget() {
  const e = setup('BlastyBiz-Admin.html'), { w, node } = e;
  await w.loadFunnelWidget();
  ok(node('funnel-widget-body').textContent.includes('3 incomplete') && node('funnel-widget-meta').textContent.includes('As of'), 'overview populated and timestamp');
  e.set(reply({ funnel: [], totalUsers: 0 })); await w.loadFunnelWidget();
  ok(node('funnel-widget-body').textContent.includes('unavailable') && !node('funnel-widget-meta').textContent, 'legacy-only malformed response cannot appear healthy');
  e.set(reply(empty)); node('funnel-widget-refresh').click(); await tick();
  ok(node('funnel-widget-body').textContent.includes('No incomplete') && node('funnel-widget-meta').textContent.includes('As of'), 'overview retry to genuine empty with timestamp');
  e.set(reply({ ...empty, totalUsers: 0 })); await w.loadFunnelWidget();
  ok(node('funnel-widget-body').textContent.includes('No accounts'), 'overview genuine no-accounts state');
  const pending = deferred(); e.set(() => pending.promise); const request = w.loadFunnelWidget(); await tick();
  ok(node('funnel-widget-body').textContent === 'Loading…' && !node('funnel-widget-meta').textContent, 'overview loading clears stale results');
  e.auth(null); pending.resolve(reply(populated)); await request;
  ok(node('funnel-widget-body').textContent.includes('Sign in') && !node('funnel-widget-meta').textContent && node('funnel-widget-refresh').disabled, 'overview auth loss rejects stale response');
  e.dom.window.close();
}
(async () => { await operate(); await widget(); console.log(`Onboarding UI: ${checks} DOM behavior assertions passed; fixture-only, no live data or sends.`); })().catch(error => { console.error(error); process.exitCode = 1; });
