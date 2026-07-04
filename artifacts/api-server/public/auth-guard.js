import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// Safety valve — if authStateReady rejects or onAuthStateChanged never fires,
// reveal the body after 5s so pages never stay permanently hidden.
const _safetyTimer = setTimeout(() => {
  document.body.style.visibility = 'visible';
}, 5000);

auth.authStateReady()
  .catch(() => {})
  .then(() => {
    onAuthStateChanged(auth, (user) => {
      if (user && user.emailVerified) {
        // Fully authenticated and verified — show page
        clearTimeout(_safetyTimer);
        document.body.classList.add('logged-in');
        document.body.style.visibility = 'visible';
      } else if (user && !user.emailVerified) {
        // Signed in but email not verified — redirect to Login where verify-view shows
        clearTimeout(_safetyTimer);
        window.location.href = 'BlastyBiz-Login.html';
      } else {
        // No user — wait for any in-flight OAuth redirect or token refresh before evicting.
        // Cancel the safety timer now: we must not reveal protected content during the wait.
        clearTimeout(_safetyTimer);
        setTimeout(() => {
          const current = auth.currentUser;
          if (current && current.emailVerified) {
            document.body.style.visibility = 'visible';
          } else {
            window.location.href = 'BlastyBiz-Login.html';
          }
        }, 3000);
      }
    });
  });
