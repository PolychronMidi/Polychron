// Script to convert global PascalCase identifiers (object facades) to camelCase
// and update all references across the repo. Run from project root with
//   node scripts/rename-pascal-globals.js
// This is a one‑off utility used to fix the current lint violations; it
// rewrites source files in place.

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..', 'src');

/** Recursively collect all .js file paths under a directory */
function collectFiles(dir) {
  let results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      results = results.concat(collectFiles(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

/** Convert PascalCase string to camelCase */
function toCamel(str) {
  return str.replace(/^([A-Z])/, m => m.toLowerCase());
}

function main() {
  const files = collectFiles(SRC_DIR);
  const mapping = new Map();

  // first pass: find global assignments with uppercase identifier
  const assignRegex = /^([A-Z][A-Za-z0-9_]*)\s*=/gm;
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = assignRegex.exec(content)) !== null) {
      const name = m[1];
      // ignore known legitimate globals: V, m, t, etc.  Also ignore if name already camelized
      if (name[0] !== name[0].toUpperCase()) continue; // cosmic
      // if it looks like a single letter or all-caps constant skip
      if (/^[A-Z]$/.test(name) || /^[A-Z0-9_]+$/.test(name)) continue;
      const camel = toCamel(name);
      if (camel !== name) {
        mapping.set(name, camel);
      }
    }
  }

  if (mapping.size === 0) {
    console.log('No PascalCase globals found to rename.');
    return;
  }

  console.log('Will rename the following globals:');
  for (const [oldn, newn] of mapping) {
    console.log(`${oldn} -> ${newn}`);
  }

  // second pass: apply replacements across all files
  const wordRegexCache = new Map();
  for (const file of files) {
    let content = fs.readFileSync(file, 'utf8');
    let updated = content;
    for (const [oldn, newn] of mapping) {
      if (!wordRegexCache.has(oldn)) {
        // word boundary on both sides, avoid partial matches
        wordRegexCache.set(oldn, new RegExp(`\\b${oldn}\\b`, 'g'));
      }
      const regex = wordRegexCache.get(oldn);
      updated = updated.replace(regex, newn);
    }
    if (updated !== content) {
      fs.writeFileSync(file, updated, 'utf8');
      console.log(`Updated ${file}`);
    }
  }

  console.log('Renaming complete. Please run npm run lint to verify and manually inspect breaking changes.');
}

main();
