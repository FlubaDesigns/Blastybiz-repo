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
 w.eval(source); await tick();
 return { w, dom, server: () => server, writes: () => writes, fail: value => { fail = value; }, update: value => { server = value; listener?.(snapshot()); }, signOut: async () => { w.auth.currentUser = null; authListener(null); await tick(); } };
}
(async () => {
 const f = await fixture({ legacy: { 'client-google': true, 'fb-signin': true } });
 const d = f.w.document;
 assert.equal(d.getElementById('prog-label').textContent, '2 / 20 done');
 assert.equal(d.getElementById('chk-fb-signin').getAttribute('aria-pressed'), 'true');
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
 row = [...d.querySelectorAll('.todo-row')].find(row => row.textContent.includes('New task'));
 row.querySelector('.todo-edit').click(); d.getElementById('todo-title').value = 'Edited';
 d.getElementById('todo-form').dispatchEvent(new f.w.Event('submit', { cancelable: true })); await tick();
 assert.equal(f.server().tasks[task.id].done, true); assert.equal(f.server().tasks[task.id].title, 'Edited');
 const reload = await fixture({ server: f.server() }); assert.equal(reload.server().tasks[task.id].title, 'Edited');
 assert.equal(Object.values(reload.server().tasks).filter(task => task.id === 'square-checkout').length, 1);
 const remote = structuredClone(f.server()); remote.tasks[task.id].title = 'Other device edit'; f.update(remote);
 assert(d.getElementById('todo-list').textContent.includes('Other device edit'));
 d.getElementById('todo-add').click(); d.getElementById('todo-title').value = 'Cancel me'; d.getElementById('todo-close').click();
 assert.equal(d.getElementById('todo-editor').hidden, true); assert(!Object.values(f.server().tasks).some(task => task.title === 'Cancel me'));
 f.fail(true); d.getElementById('chk-client-google').click(); await tick();
 assert.match(d.getElementById('todo-status').textContent, /Not saved/); assert.equal(f.server().tasks['client-google'].done, true);
 assert.equal(d.getElementById('chk-client-google').disabled, false);
 f.fail(false); d.getElementById('chk-client-google').click(); await tick(); assert.equal(f.server().tasks['client-google'].done, false);
 await f.signOut(); assert.equal(d.getElementById('todo-add').disabled, true); assert.equal(d.getElementById('todo-list').textContent, '');
 const guest = await fixture({ signedOut: true }); assert.equal(guest.writes(), 0); assert.equal(guest.w.document.getElementById('todo-add').disabled, true);
 f.dom.window.close(); reload.dom.window.close(); guest.dom.window.close();
 console.log('Operate DOM: create/edit/complete/reload/realtime, double click, migration, Square dedup, safe text, close/cancel, failed save/retry, sign-out boundaries passed.');
})().catch(error => { console.error(error); process.exit(1); });
