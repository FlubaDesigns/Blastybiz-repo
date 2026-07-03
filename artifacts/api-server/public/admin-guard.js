import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const ADMIN_EMAILS = ['perceys@gmail.com'];

const _safetyTimer = setTimeout(() => {
  document.body.style.visibility = 'visible';
}, 5000);

auth.authStateReady()
  .catch(() => {})
  .then(() => {
    onAuthStateChanged(auth, (user) => {
      if (user && ADMIN_EMAILS.includes(user.email)) {
        clearTimeout(_safetyTimer);
        document.body.style.visibility = 'visible';
      } else if (user) {
        // Logged in but not admin — redirect to dashboard
        clearTimeout(_safetyTimer);
        window.location.href = 'BlastyBiz-Dashboard.html';
      } else {
        setTimeout(() => {
          clearTimeout(_safetyTimer);
          if (!auth.currentUser) {
            window.location.href = 'BlastyBiz-Login.html';
          } else if (!ADMIN_EMAILS.includes(auth.currentUser.email)) {
            window.location.href = 'BlastyBiz-Dashboard.html';
          } else {
            document.body.style.visibility = 'visible';
          }
        }, 3000);
      }
    });
  });
