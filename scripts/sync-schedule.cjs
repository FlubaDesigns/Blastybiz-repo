'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'functions/lib/schedule.js'));
const target=path.join(root,'public/schedule-utils.js');
if(process.argv.includes('--check')) {
  if(!fs.existsSync(target)||!source.equals(fs.readFileSync(target)))throw Error('Run node scripts/sync-schedule.cjs to refresh the generated browser schedule asset.');
} else fs.writeFileSync(target,source);
