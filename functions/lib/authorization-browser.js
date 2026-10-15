// Browser-bound handoff adapted from QR Gear's existing Authorization Engine protocol.
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAuthorizationEngineAuth = registerAuthorizationEngineAuth;
const node_crypto_1 = __importDefault(require("node:crypto"));
const google_auth_library_1 = require("google-auth-library");
const AUTHORIZATION_ENGINE_SESSIONS_COLLECTION = 'authorizationEngineSessions';
const REQUEST_LIFETIME_MS = 10 * 60 * 1000;
const COOKIE = '__session'; // Firebase Hosting forwards this cookie to Functions.
const PREFIX = 'blasty-engine-';
const hash = (value) => node_crypto_1.default.createHash('sha256').update(value).digest('hex');
const validId = (value) => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
function registerAuthorizationEngineAuth(app, dependencies) {
    const { db, auth, ownerIds } = dependencies;
    const now = dependencies.now || Date.now;
    const google = new google_auth_library_1.OAuth2Client();
    const verifyIdentity = dependencies.verifyIdentity || (async (token, audience) => {
        const ticket = await google.verifyIdToken({ idToken: token, audience });
        return ticket.getPayload() || {};
    });
    let config = null;
    try {
        const value = JSON.parse(dependencies.config || 'null');
        if (value && value.projectId === dependencies.projectId &&
            new URL(value.origin).origin === value.origin && value.origin.startsWith('https://') &&
            typeof value.principal === 'string' && /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(value.principal))
            config = value;
    }
    catch { /* Not configured: the handoff remains unavailable. */ }
    const sessions = db.collection(AUTHORIZATION_ENGINE_SESSIONS_COLLECTION);
    const reject = (status = 403) => Object.assign(new Error('Authorization Engine sign-in unavailable'), { status });
    const wrap = (handler) => async (req, res) => {
        res.set('Cache-Control', 'no-store');
        try {
            if (!config || ownerIds.length !== 1)
                throw reject(404);
            await handler(req, res);
        }
        catch (error) {
            // Never log requests, cookies, bearer tokens, or Firebase custom tokens.
            console.warn('[AuthorizationEngine] Browser handoff failed', error?.status || 500, error?.code || 'request_rejected');
            res.status(error?.status || 500).json({ error: 'Authorization Engine sign-in could not complete.' });
        }
    };
    const requireBrowser = (req) => {
        if (req.get('origin') !== config.origin)
            throw reject();
    };
    const requirePending = (data) => {
        if (!data || data.expiresAtMs <= now() || data.origin !== config.origin || data.status === 'consumed')
            throw reject(410);
    };
    const cookieHash = (req) => {
        const cookie = (req.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
        if (!cookie?.startsWith(PREFIX) || !/^[a-f0-9]{64}$/.test(cookie.slice(PREFIX.length)))
            throw reject();
        return hash(cookie.slice(PREFIX.length));
    };
    const requireOwner = async () => {
        const user = await auth.getUser(ownerIds[0]);
        if (user.disabled || !user.emailVerified || user.uid !== ownerIds[0])
            throw reject();
        const [profile, deletion, admins] = await Promise.all([
            db.collection('users').doc(user.uid).get(),
            db.collection('accountDeletions').doc(user.uid).get(),
            db.collection('config').doc('admins').get(),
        ]);
        if (!profile.exists || deletion.exists || !admins.data()?.emails?.includes(user.email))
            throw reject();
        return user.uid;
    };
    app.post('/auth/engine/session', wrap(async (req, res) => {
        requireBrowser(req);
        const id = node_crypto_1.default.randomUUID(), verifier = node_crypto_1.default.randomBytes(32).toString('hex');
        const createdAtMs = now(), expiresAtMs = createdAtMs + REQUEST_LIFETIME_MS;
        const rateRef = sessions.doc('rate-' + hash(req.ip || req.socket.remoteAddress || 'unknown'));
        await db.runTransaction(async (tx) => {
            const rate = (await tx.get(rateRef)).data();
            const count = rate?.expiresAtMs > createdAtMs ? Number(rate?.count) : 0;
            if (count >= 5)
                throw reject(429);
            tx.set(rateRef, { count: count + 1, expiresAtMs: rate?.expiresAtMs > createdAtMs ? rate?.expiresAtMs : expiresAtMs });
            tx.create(sessions.doc(id), { status: 'pending', verifierHash: hash(verifier), origin: config.origin, createdAtMs, expiresAtMs });
        });
        res.cookie(COOKIE, PREFIX + verifier, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth/engine', maxAge: REQUEST_LIFETIME_MS });
        // Request IDs identify the handoff; they are not credentials and cannot approve it.
        res.status(201).json({ requestId: id, expiresAtMs });
    }));
    app.post('/auth/engine/session/:id/approve', wrap(async (req, res) => {
        if (!validId(req.params.id))
            throw reject(400);
        const match = /^Bearer ([^\s]+)$/.exec(req.get('authorization') || '');
        if (!match)
            throw reject(401);
        let identity;
        try {
            identity = await verifyIdentity(match[1], config.origin + '/api/auth/engine/session');
        }
        catch {
            throw reject(401);
        }
        if (identity.email !== config.principal || identity.email_verified !== true ||
            !identity.iat || now() - identity.iat * 1000 > 5 * 60 * 1000 || identity.iat * 1000 > now() + 60_000)
            throw reject();
        const ownerUid = await requireOwner();
        await db.runTransaction(async (tx) => {
            const ref = sessions.doc(req.params.id), data = (await tx.get(ref)).data();
            requirePending(data);
            if (data?.status !== 'pending')
                throw reject(409);
            tx.update(ref, { status: 'approved', ownerUid, approvedAtMs: now(), approvedBy: identity.email });
        });
        res.json({ approved: true, requestId: req.params.id });
    }));
    app.post('/auth/engine/session/:id', wrap(async (req, res) => {
        requireBrowser(req);
        if (!validId(req.params.id))
            throw reject(400);
        const verifierHash = cookieHash(req);
        const ownerUid = await db.runTransaction(async (tx) => {
            const ref = sessions.doc(req.params.id), data = (await tx.get(ref)).data();
            requirePending(data);
            if (data?.verifierHash !== verifierHash)
                throw reject();
            if (data.status === 'pending')
                return null;
            if (data.status !== 'approved' || data.ownerUid !== ownerIds[0])
                throw reject();
            tx.update(ref, { status: 'consumed', consumedAtMs: now() });
            return data.ownerUid;
        });
        if (!ownerUid) {
            res.status(202).json({ status: 'pending' });
            return;
        }
        await requireOwner();
        const customToken = await auth.createCustomToken(ownerUid, { authorizationEngineSession: req.params.id });
        res.clearCookie(COOKIE, { httpOnly: true, secure: true, sameSite: 'strict', path: '/api/auth/engine' });
        res.json({ customToken });
    }));
}
