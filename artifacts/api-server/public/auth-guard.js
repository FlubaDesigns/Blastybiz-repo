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
      if (user) {
        clearTimeout(_safetyTimer);
        document.body.classList.add('logged-in');
        document.body.style.visibility = 'visible';
      } else {
        // Wait for any in-flight OAuth redirect or token refresh before evicting
        setTimeout(() => {
          clearTimeout(_safetyTimer);
          if (!auth.currentUser) {
            window.location.href = 'BlastyBiz-Login.html';
          } else {
            document.body.style.visibility = 'visible';
          }
        }, 3000);
      }
    });
  });
