import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { pingActivity } from './activity-ping.js';

import { parseAuthReturn } from './auth-return.js?v=20261004-flow';
function rememberDraftDestination() {
  const target = parseAuthReturn(window.location.pathname, window.location.search);
  if (target) { try { sessionStorage.setItem('bb_draft_return', JSON.stringify(target)); } catch (_) {} }
}
function redirectToLogin() { rememberDraftDestination(); window.location.href = 'BlastyBiz-Login.html?intent=signin'; }

// Safety valve: if auth never resolves, redirect to login — never reveal protected content.
const _safetyTimer = setTimeout(() => {
  redirectToLogin();
}, 5000);

// Magic-link sign-in: oobCode in URL means Firebase is completing email link auth.
// Give extra time for the module script to call signInWithEmailLink before evicting.
const _isMagicLink = new URLSearchParams(window.location.search).has('oobCode');

auth.authStateReady()
  .catch(() => {})
  .then(() => {
    onAuthStateChanged(auth, (user) => {
      if (user && user.emailVerified) {
        // Fully authenticated and verified — show page
        clearTimeout(_safetyTimer);
        document.body.classList.add('logged-in');
        document.body.style.visibility = 'visible';
        pingActivity(user);
      } else if (user && !user.emailVerified) {
        // Signed in but email not verified — redirect to Login where verify-view shows
        clearTimeout(_safetyTimer);
        redirectToLogin();
      } else {
        // No user — wait for any in-flight OAuth redirect or token refresh before evicting.
        // Magic-link completions need more time (network round-trip to Firebase).
        clearTimeout(_safetyTimer);
        setTimeout(() => {
          const current = auth.currentUser;
          if (current && current.emailVerified) {
            document.body.style.visibility = 'visible';
          } else {
            redirectToLogin();
          }
        }, _isMagicLink ? 8000 : 3000);
      }
    });
  });
