#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const repoRoot = process.cwd();
const IGNORES = ['node_modules', 'output', 'log', 'csv_maestro', 'tests', 'test'];

function walk(dir) {
  const res = [];
  for (const name of fs.readdirSync(dir)) {
    if (IGNORES.includes(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) res.push(...walk(full));
    else if (name.endsWith('.js')) res.push(full);
  }
  return res;
}

function fixFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  const orig = src;

  // 1) Remove trailing whitespace on each line
  src = src.replace(/[ \t]+$/gm, '');

  // 2) Replace common "unnecessary" escapes inside string literals only
  // We parse strings with a simple regex (works for typical literals). Won't touch regex literals.
  src = src.replace(/(['"`])((?:\\.|(?!\1).)*?)\1/gs, (m, quote, inner) => {
    let newInner = inner
      // remove escaped forward slash in strings: / -> /
      .replaceAll('\\/', '/')
      // remove unnecessary escapes before punctuation ) ] } (safe in strings)
      .replaceAll('\\)', ')')
      .replaceAll('\\]', ']')
      .replaceAll('\\}', '}')
      .replaceAll('\\(', '(');
    if (newInner === inner) return m; // no change
    // Reconstruct literal, preserving quote type
    // Need to re-escape the quote char inside if it appears
    const escapedInner = newInner.replace(new RegExp('\\' + quote, 'g'), '\\' + quote);
    return quote + escapedInner + quote;
  });

  if (src !== orig) {
    fs.writeFileSync(file, src, 'utf8');
    console.log('Fixed:', file);
    return true;
  }
  return false;
}

(function main(){
  const files = walk(repoRoot);
  let changed = 0;
  for (const f of files) {
    try { if (fixFile(f)) changed++; } catch (e) { console.error('ERR', f, e.message); }
  }
  console.log(`Completed: ${changed} files changed.`);
})();
