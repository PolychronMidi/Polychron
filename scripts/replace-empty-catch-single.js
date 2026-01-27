const fs = require('fs');
const path = require('path');
const file = process.argv[2];
if (!file) { console.error('Usage: node replace-empty-catch-single.js <file>'); process.exit(1); }
const p = path.resolve(file);
let s = fs.readFileSync(p, 'utf8');
const before = s;
const newS = s.replace(/catch \(([^)]*)\) \{\s*\}/g, (m, p1) => `catch (${p1}) { /* swallow */ }`);
if (newS !== s) {
  fs.writeFileSync(p, newS, 'utf8');
  console.log(`Patched ${file}`);
} else {
  console.log(`No change for ${file}`);
}
