'use strict';
const { admin, db } = require('./db');
const { bbLog }     = require('./logging');

const ALLOWED_ORIGINS = new Set([
  'https://blastybiz.com',
  'https://www.blastybiz.com',
  'https://blastybiz-9523e.web.app',
  'https://blastybiz-9523e.firebaseapp.com',
]);

function setCors(req, res) {
  const origin = req && req.headers && req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
}

async function verifyBearer(req) {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw Object.assign(new Error('Missing Authorization header'), { status: 401 });
  }
  const token = authHeader.slice(7);
  return await admin.auth().verifyIdToken(token);
}

// Bootstrap admin — always has access regardless of Firestore config.
// Additional admins are managed via config/admins in Firestore.
const BOOTSTRAP_ADMIN_EMAILS = ['info@blastybiz.com', 'perceys@gmail.com'];

async function getAdminEmails() {
  try {
    const snap = await db.collection('config').doc('admins').get();
    if (snap.exists) {
      const extra = snap.data().emails || [];
      return [...new Set([...BOOTSTRAP_ADMIN_EMAILS, ...extra])];
    }
  } catch(e) { /* fall through to bootstrap list */ }
  return BOOTSTRAP_ADMIN_EMAILS;
}

async function requireAdmin(req) {
  const decoded = await verifyBearer(req);
  if (!decoded.email_verified) {
    throw Object.assign(new Error('Email not verified'), { status: 403 });
  }
  const adminEmails = await getAdminEmails();
  if (!adminEmails.includes(decoded.email)) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
  return decoded;
}

// ── withAuth — single standard wrapper for every onRequest handler ─────────────
//   withAuth(fn)                → requires valid Firebase bearer token (user)
//   withAuth(fn, { admin:t })   → requires admin role
//   withAuth(fn, { public:t })  → no auth (public endpoint)
function withAuth(fn, opts = {}) {
  return async (req, res) => {
    setCors(req, res);
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    let decoded = null;
    if (!opts.public) {
      if (opts.admin) {
        try { decoded = await requireAdmin(req); }
        catch (e) {
          bbLog('WARNING', 'withAuth', { event: 'admin_auth_failed', status: e.status || 403, msg: e.message });
          return res.status(e.status || 403).json({ error: e.message });
        }
      } else {
        try { decoded = await verifyBearer(req); }
        catch (e) {
          bbLog('WARNING', 'withAuth', { event: 'user_auth_failed', status: 401 });
          return res.status(401).json({ error: 'Unauthorized' });
        }
      }
    }
    return fn(req, res, decoded);
  };
}

module.exports = { ALLOWED_ORIGINS, BOOTSTRAP_ADMIN_EMAILS, setCors, verifyBearer, getAdminEmails, requireAdmin, withAuth };
