'use strict';
/**
 * Auto-replace known non-ASCII characters with ASCII equivalents before lint.
 * Unknown non-ASCII chars are replaced with the sentinel ?unknown-ascii-character?
 * so the no-non-ascii ESLint rule can catch them with a targeted message.
 *
 * To add a new auto-replacement: add an entry to REPLACEMENTS below, then
 * re-run the pipeline. The sentinel will disappear once the char is mapped.
 */

const fs   = require('fs');
const path = require('path');

// Shared source of truth for the char table (also used by the proxy stripper).
const { REPLACEMENTS } = require('./non-ascii-replacements');

const SENTINEL = '?unknown-ascii-character?';
const NON_ASCII = /[^\x09\x0A\x0D\x20-\x7E]/g;

const SCAN_DIRS = ['src', 'tools/HME/scripts', 'tools/HME/tests'];
const ROOT = path.join(__dirname, '..', '..', '..');

function collectJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (e.isFile() && e.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function buildReplacementMap() {
  const map = new Map();
  for (const [char, ascii] of REPLACEMENTS) {
    map.set(char, ascii);
  }
  return map;
}

function fixFile(filePath, replacementMap) {
  const original = fs.readFileSync(filePath, 'utf8');
  if (!NON_ASCII.test(original)) return false;
  NON_ASCII.lastIndex = 0;

  let changed = false;
  const fixed = original.replace(NON_ASCII, (char) => {
    changed = true;
    if (replacementMap.has(char)) return replacementMap.get(char);
    return SENTINEL;
  });

  if (changed) fs.writeFileSync(filePath, fixed, 'utf8');
  return changed;
}

function main() {
  const replacementMap = buildReplacementMap();
  const files = SCAN_DIRS.flatMap(d => collectJsFiles(path.join(ROOT, d)));
  let fixed = 0;
  let sentinelCount = 0;

  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const before = fs.readFileSync(f, 'utf8');
    const changed = fixFile(f, replacementMap);
    if (changed) {
      fixed++;
      const after = fs.readFileSync(f, 'utf8');
      const sentinels = (after.match(/\?unknown-ascii-character\?/g) || []).length;
      if (sentinels > 0) {
        sentinelCount += sentinels;
        console.log('  fix-non-ascii: ' + rel + ' -- ' + sentinels + ' unknown char(s) replaced with sentinel');
      } else {
        console.log('  fix-non-ascii: ' + rel + ' -- auto-replaced');
      }
      void before;
    }
  }

  if (fixed === 0) {
    console.log('fix-non-ascii: no non-ASCII characters found');
  } else if (sentinelCount > 0) {
    console.log('fix-non-ascii: fixed ' + fixed + ' file(s); ' + sentinelCount + ' unknown char(s) replaced with sentinel -- lint will catch them');
  } else {
    console.log('fix-non-ascii: fixed ' + fixed + ' file(s), all chars auto-replaced');
  }
}

main();
