import { auth } from './firebase-init-v2.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

const CF_BASE = 'https://us-central1-blastybiz-9523e.cloudfunctions.net';

// Safety valve: if auth never resolves, redirect to login — never reveal admin content.
const _safetyTimer = setTimeout(() => {
  window.location.href = 'BlastyBiz-Login.html';
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
          } else {
            // User appeared during the 3s wait — re-run the check
            window.location.reload();
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
        // CF check failed — fail closed, redirect rather than reveal admin page
        window.location.href = 'BlastyBiz-Dashboard.html';
      }
    });
  });
