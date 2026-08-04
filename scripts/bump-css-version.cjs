const fs   = require('fs');
const path = require('path');

const publicDir = 'public';
const version   = Date.now();

const files = fs.readdirSync(publicDir).filter(f => f.endsWith('.html'));
files.forEach(f => {
  const filePath = path.join(publicDir, f);
  let content    = fs.readFileSync(filePath, 'utf8');
  const updated  = content.replace(/global-style\.css\?v=\d+/g, `global-style.css?v=${version}`);
  if (updated !== content) {
    fs.writeFileSync(filePath, updated);
    console.log(`  bumped ${f} → v=${version}`);
  }
});

console.log(`CSS version set to ${version} across ${files.length} HTML files.`);
