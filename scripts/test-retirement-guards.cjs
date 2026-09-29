'use strict';
const assert=require('node:assert/strict');
const {validatePreflight}=require('./retire-legacy-functions.cjs');
const expected=[{name:'oldWorker',expectedUpdateTime:'2026-09-04T00:00:00Z'}];
const fixture=()=>({functions:[{name:'projects/blastybiz-9523e/locations/us-central1/functions/oldWorker',updateTime:expected[0].expectedUpdateTime,serviceConfig:{uri:'https://old-worker.run.app'}}],jobs:[{name:'projects/blastybiz-9523e/locations/us-central1/jobs/firebase-schedule-oldWorker-us-central1',httpTarget:{uri:'https://old-worker.run.app/'}}],data:{advertising:0,blastRuns:0,onboardingDrafts:0,legacyRunJobs:0,legacyEnabledSchedules:0},traffic:{truncated:false,successfulNonOptions:0}});
let assertions=0;
function rejects(mutate,pattern){const state=fixture();mutate(state);assert.throws(()=>validatePreflight(state,expected),pattern);assertions++;}
assert.deepEqual(validatePreflight(fixture(),expected).retired,['oldWorker']);assertions++;
rejects(s=>s.functions[0].updateTime='changed',/Candidate changed/);
for(const key of Object.keys(fixture().data)){
 rejects(s=>s.data[key]=1,/Legacy data dependency/);
 rejects(s=>delete s.data[key],/Legacy data dependency/);
}
rejects(s=>s.traffic.successfulNonOptions=1,/caller traffic/);
rejects(s=>s.traffic.truncated=true,/evidence incomplete/);
rejects(s=>delete s.traffic.truncated,/evidence incomplete/);
rejects(s=>s.jobs[0].httpTarget.uri='https://current-worker.run.app',/target does not match/);
rejects(s=>s.jobs[0].name='projects/blastybiz-9523e/locations/us-central1/jobs/current-worker',/Unexpected scheduler/);
const canonical=fixture();canonical.jobs[0].httpTarget.uri='https://us-central1-blastybiz-9523e.cloudfunctions.net/oldWorker';
assert.deepEqual(validatePreflight(canonical,expected).retired,['oldWorker']);assertions++;
rejects(s=>s.jobs[0].httpTarget.uri='https://us-central1-other-project.cloudfunctions.net/oldWorker',/target does not match/);
rejects(s=>s.jobs[0].httpTarget.uri='https://us-central1-blastybiz-9523e.cloudfunctions.net/currentWorker',/target does not match/);
rejects(s=>delete s.jobs[0].httpTarget.uri,/target does not match/);
rejects(s=>{s.functions=[];s.jobs[0].httpTarget.uri='https://current-worker.run.app';},/target does not match/);
const retry=fixture();retry.functions=[];retry.jobs=[];
assert.deepEqual(validatePreflight(retry,expected),{retired:['oldWorker'],jobs:[]});assertions++;
console.log(`Retirement guard checks: ${assertions} passed; no network or data writes.`);
