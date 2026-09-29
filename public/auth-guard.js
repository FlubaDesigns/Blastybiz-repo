import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { pingActivity } from './activity-ping.js';

// Preserve only the signed-email draft destination across sign-in; never an arbitrary URL.
function rememberDraftDestination() {
  const q = new URLSearchParams(window.location.search);
  if (!/\/BlastyBiz(?:\.html)?$/.test(window.location.pathname)) return;
  const ids = ['bizId','draftId','ownerUid'].map(k => q.get(k));
  if (!ids.every(x => x && x.length <= 128 && !x.includes('/'))) return;
  try { sessionStorage.setItem('bb_draft_return', JSON.stringify({bizId:ids[0],draftId:ids[1],ownerUid:ids[2]})); } catch(_) {}
}
function redirectToLogin() { rememberDraftDestination(); window.location.href = 'BlastyBiz-Login.html'; }

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
