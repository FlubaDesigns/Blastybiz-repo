/**
 * activity-ping.js — records that an account is still in use.
 *
 * Free accounts are deleted after a long period of inactivity, so
 * users/{uid}.lastActiveAt has to be a signal we trust. Cloud Functions already
 * touch it on any authenticated call, but an owner can sign in, look around
 * their dashboard and sign out without triggering one. This covers that gap.
 *
 * Throttled to once a day per browser so it costs one write, not one per page.
 */
import { db } from './firebase-init-v2.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';

const PING_KEY = 'bb_last_active_ping';
const PING_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function pingActivity(user) {
  if (!user || !user.uid) return;
  try {
    const prev = Number(localStorage.getItem(PING_KEY) || 0);
    if (Date.now() - prev < PING_INTERVAL_MS) return;
    localStorage.setItem(PING_KEY, String(Date.now()));
  } catch (_) {
    // Private browsing with storage blocked — ping every load rather than never.
  }
  setDoc(doc(db, 'users', user.uid), { lastActiveAt: serverTimestamp() }, { merge: true })
    .catch(e => console.warn('[activity-ping]', e.message));
}
