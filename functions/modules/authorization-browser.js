'use strict';
const {onRequest, admin, db} = require('../lib/shared');
const {registerAuthorizationEngineAuth} = require('../lib/authorization-browser');
// Only the existing Main release supplies this non-secret owner/target config.
exports.authorizationBrowser = onRequest({invoker:'public',region:'us-central1'}, (req,res) => {
  let config;
  try { config = JSON.parse(process.env.AUTHORIZATION_ENGINE_BROWSER || 'null'); } catch {}
  const routes = [];
  registerAuthorizationEngineAuth({post:(path,handler)=>routes.push({path,handler})}, {
    db, auth:admin.auth(), ownerIds:config?.ownerUid ? [config.ownerUid] : [],
    projectId:process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
    config:JSON.stringify(config),
  });
  const path = req.path.replace(/^\/api/, '');
  for (const route of routes) {
    const match = new RegExp('^'+route.path.replace(':id','([^/]+)')+'$').exec(path);
    if (req.method === 'POST' && match) {
      req.params = match[1] ? {id:match[1]} : {};
      return route.handler(req,res);
    }
  }
  res.set('Cache-Control','no-store');
  return res.status(404).json({error:'Not found'});
});
