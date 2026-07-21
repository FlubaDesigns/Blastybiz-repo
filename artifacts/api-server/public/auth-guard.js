import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Safety valve: if auth never resolves, redirect to login — never reveal protected content.
const _safetyTimer = setTimeout(() => {
  window.location.href = 'BlastyBiz-Login.html';
}, 5000);

// Magic-link sign-in: oobCode in URL means Firebase is completing email link auth.
// Give extra time for the module script to call signInWithEmailLink before evicting.
const _isMagicLink = new URLSearchParams(window.location.search).has('oobCode');

auth.authStateReady()
  .catch(() => {})
  .then(() => {
    onAuthStateChanged(auth, (user) => {
      if (user) {
        // Authenticated — show page
        clearTimeout(_safetyTimer);
        document.body.classList.add('logged-in');
        document.body.style.visibility = 'visible';
      } else {
        // No user — wait for any in-flight OAuth redirect or token refresh before evicting.
        // Magic-link completions need more time (network round-trip to Firebase).
        clearTimeout(_safetyTimer);
        setTimeout(() => {
          if (auth.currentUser) {
            document.body.style.visibility = 'visible';
          } else {
            window.location.href = 'BlastyBiz-Login.html';
          }
        }, _isMagicLink ? 8000 : 3000);
      }
    });
  });
