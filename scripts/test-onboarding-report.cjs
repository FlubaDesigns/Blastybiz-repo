'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { database } = require('./lib/test-firestore.cjs');
const { buildOnboardingReport } = require('../functions/lib/onboarding-report');
const { validate } = require('../public/onboarding-report');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const source = read('functions/modules/admin.js');
let assertions = 0;
function ok(value, message) { assert(value, message); assertions++; }
function eq(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
function rejectsValue(value, step) { assert.throws(() => validate(value, step), /unavailable/); assertions++; }
function endpoint(db) {

  const context = { exports: {}, console: { error() {} }, require(name) {
    if (name === '../lib/shared') return { db, onRequest: (_options, fn) => fn,
      withAuth: (fn, options) => { fn.authOptions = options; return fn; } };
    if (name === './publishing') return {};
    if (name === '../lib/onboarding-report') return { buildOnboardingReport };
    throw new Error('Unexpected import ' + name);
  } };
  vm.runInNewContext(source, context);
  return { run: async query => {
    const response = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; } };
    await context.exports.adminOnboardingFunnel({ query }, response);
    return response;
  }, protectedHandler: context.exports.adminOnboardingFunnel.authOptions?.admin === true };
}
async function main() {
  const seed = {
    'users/new': { onboarded: false, email: 'new@example.invalid', createdAt: { stamp: 1700000000000 } },
    'users/draft': { onboarded: true, email: 'draft@example.invalid', createdAt: 'not a date' },
    'users/draft/businesses/a': { uid: 'other', businessName: 'A name alone cannot override false', onboarded: false },
    'users/done': { onboarded: false },
    'users/done/businesses/a': { onboarded: false },
    'users/done/businesses/b': { onboarded: true },
    'users/legacy': {},
    'users/legacy/businesses/a': { businessName: 'Legacy business' },
    'users/blank': {},
    'users/blank/businesses/a': { businessName: '   ' },
    'users/historical': { onboarded: true },
    'users/unknown': {},
    'businesses/legacy-root': { uid: 'unknown', onboarded: true },
    'users/orphan/businesses/a': { onboarded: true },
  };
  const m = database(seed), api = endpoint(m.db);
  ok(api.protectedHandler, 'existing admin-only wrapper is retained');
  const result = await api.run({});
  eq(result.code, 200);
  const report = validate(result.body);
  eq(report.totalUsers, 7);
  eq(report.totalNotOnboarded, 4, 'unique incomplete accounts; explicit flags, legacy records and historical completion respected');
  eq(report.steps.map(s => [s.stepIndex, s.count]), [[0, 2], [1, 2]]);
  ok(Array.isArray(report.funnel) && report.funnel.length === 7, 'legacy aggregate shape retained');
  ok(!Object.hasOwn(report, 'users') && !Object.hasOwn(report, 'usersByStep'), 'summary does not include account details');
  ok(Math.abs(Date.now() - Date.parse(report.asOf)) < 10000, 'server snapshot timestamp is current and valid');
  const details = validate((await api.run({ stepIndex: '1' })).body, 1);
  eq(details.users.map(u => u.uid), ['blank', 'draft'], 'path ownership and one-account grouping');
  eq(details.users.find(u => u.uid === 'draft').createdAt, null, 'invalid source timestamps are unknown');
  ok(!details.users.some(u => 'lastProgressAt' in u || 'nudgeCount' in u), 'no invented inactivity or reminder history');
  const noProfile = validate((await api.run({ stepIndex: '0' })).body, 0);
  eq(noProfile.users.find(u => u.uid === 'new').createdAt, '2023-11-14T22:13:20.000Z');
  for (const bad of ['2', '-1', '', '1.0', ['1'], 0]) eq((await api.run({ stepIndex: bad })).code, 400, 'invalid detail group rejected');
  const empty = validate((await endpoint(database().db).run({})).body);
  eq(empty.steps, []); eq(empty.totalNotOnboarded, 0); eq(empty.totalUsers, 0);
  validate((await endpoint(database().db).run({ stepIndex: '0' })).body, 0);
  const complete = validate((await endpoint(database({ 'users/u': { onboarded: true } }).db).run({})).body);
  eq(complete.totalNotOnboarded, 0); eq(complete.totalUsers, 1);
  for (const family of ['users', 'businesses', 'listingDrafts', 'publishJobs', 'platformConnections']) {
    const oversize = { docs: [], size: family === 'publishJobs' ? 5001 : 2001 };
    const chain = name => ({ where() { return this; }, limit() { return this; }, async get() { return name === family ? oversize : { docs: [], size: 0 }; } });
    eq((await endpoint({ collection: chain, collectionGroup: chain }).run({})).code, 503, family + ' truncation fails closed');
  }
  const fail = () => ({ limit() { return this; }, async get() { throw Error('fixture offline'); } });
  const unavailable = await endpoint({ collection: fail }).run({});
  eq(unavailable.code, 500); ok(!('steps' in unavailable.body), 'read failure is never successful empty');
  for (const bad of [null, {}, { funnel: [], totalUsers: 0 }, { ...empty, asOf: undefined }, { ...empty, asOf: 'bad' },
    { ...empty, totalUsers: undefined }, { ...empty, totalUsers: -1 }, { ...empty, totalNotOnboarded: 1 },
    { ...report, totalUsers: 1 }, { ...report, totalStuck: 0 }, { ...report, steps: [] },
    { ...report, steps: [...report.steps, report.steps[0]] }, { ...report, steps: [{ stepIndex: '<bad>', label: 'x', count: 4 }] },
    { ...empty, steps: [{ stepIndex: 0, label: 'x', count: 0 }] }]) rejectsValue(bad);
  for (const bad of [{ ...details, users: undefined }, { ...details, users: [] }, { ...details, stepIndex: 0 },
    { ...details, users: [details.users[0], details.users[0]] }, { ...details, users: [{ ...details.users[0], createdAt: 'bad' }, details.users[1]] }]) rejectsValue(bad, 1);
  console.log(`Onboarding report: ${assertions} endpoint and contract assertions passed; local fixtures only.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
