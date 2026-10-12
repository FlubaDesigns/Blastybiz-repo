'use strict';

const SETUP_STAGES = ['No saved business profile', 'Saved setup unfinished'];

function isoTimestamp(value) {
  try {
    const date = value?.toDate ? value.toDate() : value?.toMillis ? new Date(value.toMillis())
      : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
  } catch (_) { return null; }
}

// The current setup form keeps unfinished answers on the user's device. There
// is no server-side per-question progress or inactivity clock to report.
function buildOnboardingReport(userDocs, businessDocs, now = new Date()) {
  const businessesByUser = new Map();
  for (const doc of businessDocs) {
    // Ownership is the canonical Firestore path, never a stale/spoofed uid field.
    const parts = doc.ref.path.split('/');
    if (parts.length !== 4 || parts[0] !== 'users' || parts[2] !== 'businesses') continue;
    const businesses = businessesByUser.get(parts[1]) || [];
    businesses.push(doc.data());
    businessesByUser.set(parts[1], businesses);
  }
  const usersByStep = [[], []];
  for (const doc of userDocs) {
    const user = doc.data();
    const businesses = businessesByUser.get(doc.id) || [];
    const complete = businesses.length ? businesses.some(b => b.onboarded === true ||
      (b.onboarded === undefined && typeof b.businessName === 'string' && b.businessName.trim()))
      : user.onboarded === true;
    if (complete) continue;
    usersByStep[businesses.length ? 1 : 0].push({
      uid: doc.id,
      email: typeof user.email === 'string' ? user.email : '',
      createdAt: isoTimestamp(user.createdAt),
    });
  }
  const steps = usersByStep.map((users, stepIndex) => ({ stepIndex, label: SETUP_STAGES[stepIndex], count: users.length }))
    .filter(s => s.count > 0).sort((a, b) => b.count - a.count || a.stepIndex - b.stepIndex);
  const totalNotOnboarded = usersByStep.reduce((sum, users) => sum + users.length, 0);
  return { steps, totalNotOnboarded, totalStuck: totalNotOnboarded, asOf: now.toISOString(), usersByStep };
}

module.exports = { buildOnboardingReport };
