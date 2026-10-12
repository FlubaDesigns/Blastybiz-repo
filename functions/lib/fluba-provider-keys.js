// Central Fluba provider vault; generated from the shared TypeScript reader.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearFlubaProviderKeyCache = exports.flubaProviderKeyStatus = exports.readFlubaProviderKey = exports.PROVIDER_SECRET_NAMES = exports.FLUBA_PROVIDER_PROJECT = void 0;
exports.createFlubaProviderReader = createFlubaProviderReader;
const app_1 = require("firebase-admin/app");
// Server-only reads from the owner's one authoritative provider vault.
exports.FLUBA_PROVIDER_PROJECT = 'flubadesigns-25482';
exports.PROVIDER_SECRET_NAMES = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'PRINTFUL_API_KEY', 'PRINTIFY_API_TOKEN', 'SQUARE_ACCESS_TOKEN', 'RESEND_API_KEY', 'STRIPE_SECRET_KEY'];
function createFlubaProviderReader(token, request = fetch, now = Date.now) {
    const cache = new Map();
    const pending = new Map();
    async function read(name) {
        if (!exports.PROVIDER_SECRET_NAMES.includes(name))
            throw new Error('Unsupported Fluba provider credential');
        const cached = cache.get(name);
        if (cached && cached.expires > now())
            return cached.value;
        if (pending.has(name))
            return pending.get(name);
        const operation = (async () => {
            let response;
            try {
                response = await request(`https://secretmanager.googleapis.com/v1/projects/${exports.FLUBA_PROVIDER_PROJECT}/secrets/${name}/versions/latest:access`, {
                    headers: { Authorization: `Bearer ${await token()}` }, redirect: 'error', signal: AbortSignal.timeout(8000),
                });
            }
            catch {
                throw new Error(`Fluba credential unavailable: ${name}`);
            }
            if (response.status === 404) {
                cache.delete(name);
                return '';
            }
            if (!response.ok) {
                cache.delete(name);
                throw new Error(`Fluba credential access failed: ${name} (${response.status})`);
            }
            const body = await response.json();
            const value = Buffer.from(body.payload?.data || '', 'base64').toString('utf8');
            if (!value || value === 'DISABLED_NOT_CONFIGURED') {
                cache.delete(name);
                return '';
            }
            if (value.length < 20 || value.length > 4096 || /[\s\u0000-\u001f\u007f]/.test(value))
                throw new Error(`Fluba credential format invalid: ${name}`);
            const version = String(body.name || '').split('/').pop() || '';
            if (!/^[1-9][0-9]*$/.test(version))
                throw new Error('Fluba credential version missing');
            cache.set(name, { value, version, expires: now() + 60000 });
            return value;
        })();
        pending.set(name, operation);
        try {
            return await operation;
        }
        finally {
            pending.delete(name);
        }
    }
    return { read, clear: () => cache.clear(), status: () => Object.fromEntries([...cache].map(([name, e]) => [name, { source: 'fluba', projectId: exports.FLUBA_PROVIDER_PROJECT, version: e.version, current: e.expires > now() }])) };
}
const reader = createFlubaProviderReader(async () => (await (0, app_1.applicationDefault)().getAccessToken()).access_token);
exports.readFlubaProviderKey = reader.read;
exports.flubaProviderKeyStatus = reader.status;
exports.clearFlubaProviderKeyCache = reader.clear;
