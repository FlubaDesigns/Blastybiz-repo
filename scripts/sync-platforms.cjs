#!/usr/bin/env node
// One maintained source; check mode makes stale browser copies fail CI.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'functions/lib/platforms.js'), 'utf8');
const target = path.join(root, 'public/platforms-authority.js');
if (process.argv.includes('--check')) {
  if (fs.readFileSync(target, 'utf8') !== source) throw new Error('Run node scripts/sync-platforms.cjs');
} else fs.writeFileSync(target, source);
