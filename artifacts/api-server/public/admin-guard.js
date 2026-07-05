import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const CF_BASE = 'https://us-central1-blastybiz-9523e.cloudfunctions.net';
const FALLBACK_ADMINS = ['perceys@gmail.com', 'info@blastybiz.com'];

const _safetyTimer = setTimeout(() => {
  document.body.style.visibility = 'visible';
}, 5000);

auth.authStateReady()
  .catch(() => {})
  .then(() => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        clearTimeout(_safetyTimer);
        setTimeout(() => {
          if (!auth.currentUser) {
            window.location.href = 'BlastyBiz-Login.html';
          } else if (!FALLBACK_ADMINS.includes(auth.currentUser.email)) {
            window.location.href = 'BlastyBiz-Dashboard.html';
          } else {
            document.body.style.visibility = 'visible';
          }
        }, 3000);
        return;
      }
      clearTimeout(_safetyTimer);
      try {
        const token = await user.getIdToken();
        const resp = await fetch(`${CF_BASE}/adminGetAdminEmails`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) {
          document.body.style.visibility = 'visible';
        } else {
          window.location.href = 'BlastyBiz-Dashboard.html';
        }
      } catch (e) {
        if (FALLBACK_ADMINS.includes(user.email)) {
          document.body.style.visibility = 'visible';
        } else {
          window.location.href = 'BlastyBiz-Dashboard.html';
        }
      }
    });
  });
