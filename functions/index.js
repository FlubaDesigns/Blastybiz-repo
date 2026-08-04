/**
 * BlastyBiz Cloud Functions — barrel entry point
 *
 * All function logic lives in modules/. This file only re-exports from them.
 * To deploy a single group:
 *   firebase deploy --only functions:adaptListing,functions:suggestPlatforms
 *   firebase deploy --only functions:squareWebhook
 *
 * dispatchPublishJob has retry:true — use --force when deploying it:
 *   firebase deploy --only functions:dispatchPublishJob --force
 */
'use strict';

Object.assign(exports, require('./modules/ai'));
Object.assign(exports, require('./modules/publishing'));
Object.assign(exports, require('./modules/business'));
Object.assign(exports, require('./modules/payments'));
Object.assign(exports, require('./modules/oauth'));
Object.assign(exports, require('./modules/admin'));
Object.assign(exports, require('./modules/scheduled'));
Object.assign(exports, require('./modules/misc'));
