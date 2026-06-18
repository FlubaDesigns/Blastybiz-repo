import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

auth.authStateReady().then(() => {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      document.body.style.visibility = '';
    } else {
      // Small buffer in case Custom Tab / OAuth redirect is still restoring session
      setTimeout(() => {
        if (!auth.currentUser) {
          window.location.href = 'BlastyBiz-Login.html';
        } else {
          document.body.style.visibility = '';
        }
      }, 1500);
    }
  });
});
