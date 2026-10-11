'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const model = require('../public/operate-todos.js');
const html = fs.readFileSync(path.join(__dirname, '../public/BlastyBiz-Admin-Operate.html'), 'utf8');
const defaults = [...html.matchAll(/id="chk-([^"]+)"/g)].map(match => ({ id: match[1], title: match[1], notes: '' }));
assert.equal(defaults.length, 19);
assert(defaults.some(task => task.id === 'fb-signin'));
const square = { id: model.SQUARE_ID, title: 'Fix Square checkout and verify Sandbox', notes: 'Review the payment-link request: provide quickPay or order with price and location; verify the subscription plan variation ID. Add a provider-contract test, then run an authorized Square Sandbox check. Do not use real payments.', done: false };
const original = { otherMetadata: 'preserved', tasks: Object.fromEntries([...defaults, square].map(task => [task.id, { ...task, done: false }])) };
original.tasks['google-logo'].done = true;
let state = model.migrate(original, defaults, { 'client-google': true, 'fb-signin': true });
assert.equal(Object.keys(state.tasks).length, 20);
assert.equal(model.visible(state).active.length, 0);
assert.equal(model.visible(state).completed.length, 0);
assert.equal(state.otherMetadata, 'preserved');
assert.equal(state.tasks['google-logo'].done, true);
assert.equal(state.tasks['client-google'].done, true);
assert.equal(state.tasks['fb-signin'].done, true);
assert.deepEqual(model.migrate(state, defaults), state);
assert.deepEqual(model.migrate({}, defaults).tasks, {}); // Never seed a new account.
state = model.change(state, { type: 'complete', id: 'client-google', done: false });
assert.equal(model.migrate(state, defaults, { 'client-google': true }).tasks['client-google'].done, false);
const edited = structuredClone(original);
edited.tasks['client-facebook'].notes = 'My personal appointment';
edited.tasks['client-google'].title = 'My Google action';
assert.equal(model.visible(model.migrate(edited, defaults)).active.length, 2);
state = model.change(state, { type: 'save', id: 'custom', title: 'New task', notes: 'First notes' });
assert.equal(model.visible(state).active.length, 1);
state = model.change(state, { type: 'complete', id: 'custom', done: true });
assert.equal(model.visible(state).active.length, 0);
assert.equal(model.visible(state).completed.length, 1);
state = model.change(state, { type: 'save', id: 'custom', title: 'Edited task', notes: '<img src=x onerror=alert(1)>' });
assert.equal(state.tasks.custom.done, true);
assert.equal(state.tasks.custom.title, 'Edited task');
assert.deepEqual(model.migrate(JSON.parse(JSON.stringify(state)), defaults), state);
// Unknown/user-created Square tasks are not inferred to be legacy defaults.
const customSquare = model.migrate({ tasks: { existing: { id: 'existing', title: square.title, notes: square.notes, done: false } } }, defaults);
assert.equal(model.visible(customSquare).active.length, 1);
assert(!customSquare.tasks[model.SQUARE_ID]);
// An explicit edit survives even when it restores the exact old wording.
const restored = model.change(state, { type: 'save', id: square.id, title: square.title, notes: square.notes });
assert.equal(model.visible(model.migrate(restored, defaults)).active.length, 1);
assert.equal(model.migrate({}, defaults, { 'google-logo': true }).tasks['google-logo'].done, true);
// Old clients may retain archive metadata while editing a historical row.
const oldClientEdit = structuredClone(state);
oldClientEdit.tasks['client-google'].title = 'Meet the owner for approval';
assert.equal(model.visible(model.migrate(oldClientEdit, defaults)).active.length, 1);
// Migration/save retry sees another device's latest custom task and edits.
const concurrent = model.change(model.migrate({ ...original, tasks: { ...original.tasks, custom: { id: 'custom', title: 'Owner approval', notes: '', done: false } } }, defaults), { type: 'save', id: 'new', title: 'Call vendor', notes: '' });
assert.equal(model.visible(concurrent).active.length, 2);
assert.deepEqual(model.readLegacy({ getItem() { throw Error('Blocked storage'); } }), {});
assert.deepEqual(model.readLegacy({ getItem() { return 'null'; } }), {});
assert.throws(() => model.change(state, { type: 'save', id: 'bad', title: '  ' }));
assert.throws(() => model.change(state, { type: 'save', id: '../bad', title: 'Bad' }));
// Transaction retry: apply each operation against the current server snapshot.
let server = model.change(state, { type: 'save', id: 'a', title: 'Other admin addition' });
server = model.change(server, { type: 'complete', id: 'custom', done: false });
assert.equal(server.tasks.a.title, 'Other admin addition');
assert.equal(server.tasks.custom.done, false);
assert.equal(server.tasks.custom.title, 'Edited task');
// This feature reuses the existing verified-admin-only document boundary.
const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
assert.match(rules, /match \/config\/\{doc\} \{\s*allow read, write: if isAdmin\(\);/);
assert.match(rules, /request\.auth != null && request\.auth\.token\.email_verified == true/);
assert.match(rules, /request\.auth\.token\.email in get\(/);
console.log('Operate to-do model: owner-only defaults migration, no reseeding, preservation, create/edit/complete/reload, retries, validation, existing auth boundary passed.');
