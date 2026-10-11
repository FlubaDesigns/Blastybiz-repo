'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const root = path.join(__dirname, '../public');
const source = fs.readFileSync(path.join(root, 'operate-todos-ui.js'), 'utf8').replace(/^import .*;\n/gm, '');
const html = fs.readFileSync(path.join(root, 'BlastyBiz-Admin-Operate.html'), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function fixture(options = {}) {
 const dom = new JSDOM(html, { url: 'https://fixture.invalid/BlastyBiz-Admin-Operate.html', runScripts: 'outside-only' });
 const w = dom.window;
 let server = options.server || {}, listener, authListener, writes = 0, fail = false;
 const user = { uid: 'admin', emailVerified: true };
 w.auth = { currentUser: options.signedOut ? null : user }; w.db = {};
 w.HTMLElement.prototype.scrollIntoView = function() {};
 w.updateBadge = () => {};
 w.doc = (_, collection, id) => { assert.equal(collection + '/' + id, 'config/operateTodos'); return {}; };
 w.onAuthStateChanged = (_, callback) => { authListener = callback; callback(w.auth.currentUser); };
 const snapshot = () => ({ data: () => structuredClone(server), metadata: { fromCache: false } });
 w.runTransaction = async (_, callback) => {
   if (fail) throw Error('Permission denied');
   await callback({ get: async () => snapshot(), set: (_, value) => { server = structuredClone(value); writes++; } });
   listener?.(snapshot());
 };
 w.onSnapshot = (_, callback) => { listener = callback; callback(snapshot()); return () => { listener = null; }; };
 if (options.legacy) w.localStorage.setItem('blastybiz_operate_checks', JSON.stringify(options.legacy));
 w.eval(fs.readFileSync(path.join(root, 'operate-todos.js'), 'utf8'));
 if (options.seeded) {
   const defaults = [...w.document.querySelectorAll('template[data-legacy-todos]')].flatMap(template => [...template.content.querySelectorAll('.check-box[id^="chk-"]')]).map(box => {
     const header = box.closest('.op-card-header');
     return { id: box.id.slice(4), title: header.querySelector('.op-card-title').textContent.trim(), notes: header.querySelector('.op-card-sub').textContent.trim(), done: false };
   });
   const square = { id: 'square-checkout', title: 'Fix Square checkout and verify Sandbox', notes: 'Review the payment-link request: provide quickPay or order with price and location; verify the subscription plan variation ID. Add a provider-contract test, then run an authorized Square Sandbox check. Do not use real payments.', done: false };
   server = { tasks: Object.fromEntries([...defaults, square].map(task => [task.id, task])) };
   assert.equal(Object.keys(server.tasks).length, 20);
 }
 w.eval(source); await tick();
 return { w, dom, server: () => server, writes: () => writes, fail: value => { fail = value; }, update: value => { server = value; listener?.(snapshot()); }, signOut: async () => { w.auth.currentUser = null; authListener(null); await tick(); } };
}
(async () => {
 const f = await fixture({ seeded: true, legacy: { 'client-google': true, 'fb-signin': true } });
 const d = f.w.document;
 assert.equal(d.getElementById('prog-label').textContent, '0 open actions');
 assert.equal(d.getElementById('todo-empty').hidden, false);
 assert.equal(d.querySelectorAll('.check-box[id^="chk-"]').length, 0);
 assert.equal(f.server().tasks['fb-signin'].done, true);
 assert.equal(Object.keys(f.server().tasks).length, 20);
 assert(Object.values(f.server().tasks).every(task => task.archivedReason));
 assert(d.getElementById('mascot-anim-toggle')); assert(d.getElementById('new-admin-email')); assert(d.getElementById('funnel-chart'));
 assert.equal(f.w.localStorage.getItem('blastybiz_operate_checks:migrated:admin'), '1');
 assert(f.w.localStorage.getItem('blastybiz_operate_checks')); // backup retained
 d.getElementById('todo-add').click();
 d.getElementById('todo-title').value = 'New task'; d.getElementById('todo-notes').value = '<img src=x onerror=alert(1)>';
 d.getElementById('todo-form').dispatchEvent(new f.w.Event('submit', { bubbles: true, cancelable: true }));
 await tick();
 const task = Object.values(f.server().tasks).find(task => task.title === 'New task'); assert(task);
 assert.equal(d.getElementById('todo-editor').hidden, true);
 assert.equal(d.querySelector('#todo-list img'), null);
 let row = [...d.querySelectorAll('.todo-row')].find(row => row.textContent.includes('New task'));
 row.querySelector('.check-box').click(); row.querySelector('.check-box').click(); await tick();
 assert.equal(f.server().tasks[task.id].done, true); // repeated clicks while busy don't toggle twice
 assert.equal(d.getElementById('todo-list').children.length, 0);
 assert.equal(d.getElementById('todo-completed').open, false);
 assert.equal(d.getElementById('todo-completed').hidden, false);
 assert.equal(d.getElementById('todo-completed-heading').textContent, 'Completed (1)');
 row = [...d.querySelectorAll('.todo-row')].find(row => row.textContent.includes('New task'));
 row.querySelector('.todo-edit').click(); d.getElementById('todo-title').value = 'Edited';
 d.getElementById('todo-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await tick();
 assert.equal(f.server().tasks[task.id].done, true); assert.equal(f.server().tasks[task.id].title, 'Edited');
 const reload = await fixture({ server: f.server() }); assert.equal(reload.server().tasks[task.id].title, 'Edited');
 assert.equal(Object.values(reload.server().tasks).filter(task => task.id === 'square-checkout').length, 1);
 const remote = structuredClone(f.server()); remote.tasks[task.id].title = 'Other device edit'; f.update(remote);
 assert(d.getElementById('todo-completed-list').textContent.includes('Other device edit'));
 d.getElementById('todo-add').click(); d.getElementById('todo-title').value = 'Cancel me'; d.getElementById('todo-close').click();
 assert.equal(d.getElementById('todo-editor').hidden, true); assert(!Object.values(f.server().tasks).some(task => task.title === 'Cancel me'));
 const completedBox = d.querySelector('#todo-completed-list .check-box');
 f.fail(true); completedBox.click(); await tick();
 assert.match(d.getElementById('todo-status').textContent, /Not saved/); assert.equal(f.server().tasks[task.id].done, true);
 assert.equal(completedBox.disabled, false);
 f.fail(false); completedBox.click(); await tick(); assert.equal(f.server().tasks[task.id].done, false);
 assert.equal(d.getElementById('prog-label').textContent, '1 open action');
 await f.signOut(); assert.equal(d.getElementById('todo-add').disabled, true); assert.equal(d.getElementById('todo-list').textContent, '');
 const guest = await fixture({ signedOut: true }); assert.equal(guest.writes(), 0); assert.equal(guest.w.document.getElementById('todo-add').disabled, true);
 const fresh = await fixture(); assert.equal(Object.keys(fresh.server().tasks).length, 0);
 const twice = await fixture({ server: fresh.server() }); assert.equal(twice.writes(), 0);
 for (const entry of [f, reload, guest, fresh, twice]) entry.dom.window.close();
 console.log('Operate DOM: create/edit/complete/reload/realtime, double click, migration, 20 archived defaults, no reseeding, owner counts, completed collapse, safe text, close/cancel, failed save/retry, sign-out boundaries passed.');
})().catch(error => { console.error(error); process.exit(1); });
