#!/usr/bin/env node
// One maintained source; check mode makes stale browser/API projections fail CI.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const authority = require('../functions/lib/platforms');
const outputs = {
  'public/platforms-authority.js': fs.readFileSync(path.join(root, 'functions/lib/platforms.js'), 'utf8'),
  'public/platforms-authority.json': JSON.stringify({platforms: authority.PLATFORM_DEFAULTS.map(p => ({...p, imageLimit: authority.postImageLimit(p.slug)}))}, null, 2) + '\n'
};
for (const [name, content] of Object.entries(outputs)) {
  const target = path.join(root, name);
  if (process.argv.includes('--check')) {
    if (fs.readFileSync(target, 'utf8') !== content) throw new Error('Run node scripts/sync-platforms.cjs');
  } else fs.writeFileSync(target, content);
}
