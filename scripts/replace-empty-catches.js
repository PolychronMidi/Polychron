const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const exts = ['.js', '.mjs'];
const includeDirs = ['src', 'scripts', 'test'];
let count = 0;
let filesChanged = 0;

function walk(dir) {
  const items = fs.readdirSync(dir);
  for (const it of items) {
    const p = path.join(dir, it);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      walk(p);
    } else if (exts.includes(path.extname(p))) {
      const rel = path.relative(root, p);
      if (!includeDirs.some(d => rel.startsWith(d + path.sep))) continue;
      let src = fs.readFileSync(p, 'utf8');
      const newSrc = src.replace(/catch \(([^)]*)\) \{\s*\}/g, (m, p1) => `catch (${p1}) { /* swallow */ }`);
      if (newSrc !== src) {
        fs.writeFileSync(p, newSrc, 'utf8');
        const m = (src.match(/catch \(e\) \{\s*\}/g) || []).length;
        count += m;
        filesChanged++;
        console.log(`Patched ${m} occurrences in ${rel}`);
      }
    }
  }
}

walk(root);
console.log(`Done. Replaced ${count} occurrences across ${filesChanged} files.`);
process.exit(0);
