/* Shared response validation for both admin onboarding report consumers. */
(function (root) {
  'use strict';
  const count = n => Number.isSafeInteger(n) && n >= 0;
  const validDate = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value));
  function validate(data, stepIndex) {
    const fail = () => { throw new Error('Onboarding report unavailable: invalid or incomplete response.'); };
    if (!data || !Array.isArray(data.steps) || !count(data.totalNotOnboarded) ||
        !count(data.totalUsers) || data.totalNotOnboarded > data.totalUsers || !count(data.totalStuck) || data.totalStuck !== data.totalNotOnboarded || !validDate(data.asOf)) fail();
    const seen = new Set();
    let total = 0;
    for (const step of data.steps) {
      if (!step || ![0, 1].includes(step.stepIndex) || seen.has(step.stepIndex) ||
          typeof step.label !== 'string' || !step.label.trim() || !count(step.count) || step.count === 0) fail();
      seen.add(step.stepIndex);
      total += step.count;
    }
    if (total !== data.totalNotOnboarded) fail();
    if (stepIndex !== undefined) {
      if (data.stepIndex !== stepIndex || !Array.isArray(data.users) ||
          data.users.length !== (data.steps.find(s => s.stepIndex === stepIndex)?.count || 0)) fail();
      const uids = new Set();
      for (const user of data.users) {
        if (!user || typeof user.uid !== 'string' || !user.uid || uids.has(user.uid) ||
            typeof user.email !== 'string' || !(user.createdAt === null || validDate(user.createdAt))) fail();
        uids.add(user.uid);
      }
    }
    return data;
  }
  const api = { validate };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.BBOnboardingReport = api;
})(typeof window === 'object' ? window : globalThis);
