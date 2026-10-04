/**
 * session.js — centralised sign-out and localStorage cleanup  (3.2)
 *
 * Include on every page: <script src="session.js?v=1"></script>
 * Then replace every doSignOut with: window.doSignOut = () => window._bbSignOut(auth, signOut);
 *
 * This ensures ALL BB keys are wiped on sign-out regardless of which page
 * the user signs out from — preventing PII leakage on shared devices.
 */

// Single canonical list of every BB localStorage key
window.BB_KEYS = [
  'bb_auth',
  'bb_profile',
  'bb_trial_email',
  'bb_trial_name',
  'bb_platforms_enabled',
  'bb_ml',       // magic-link email-for-sign-in
  'bb_start_choice', 'bb_guided_new', 'bb_selected_plan', 'bb_billing_period',
  'bb_setup_draft', // unfinished setup controls; cleared with the account session
  'bb_answers',  // onboarding session answers
];

/** Clear every BB key from localStorage. */
window._bbClearStorage = function () {
  window.dispatchEvent?.(new Event('bb:session-cleared'));
  window.BB_KEYS.forEach(function (k) { localStorage.removeItem(k); });
  ['bb_setup_handoff','bb_preview'].forEach(function(k){sessionStorage.removeItem(k);});
};

/**
 * Full sign-out: clear storage, sign out of Firebase, redirect to login.
 * @param {import('firebase/auth').Auth}    auth    - the Auth instance
 * @param {Function}                         signOut - firebase/auth signOut function
 */
window._bbSignOut = function (auth, signOut) {
  window._bbClearStorage();
  signOut(auth).finally(function () {
    window.location.href = 'BlastyBiz-Login.html';
  });
};
