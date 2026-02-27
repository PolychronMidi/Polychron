// scripts/generate-globals-dts.js
// Single source of truth: src/types/globals.d.ts
// Reads every `declare var NAME:` entry (preserving section comments) and
// rewrites the VALIDATED_GLOBALS array in src/play/fullBootstrap.js.
// Run automatically at the start of `npm run main` — adding a global now only
// requires editing globals.d.ts.
// globals.d.ts is never modified by this script.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT             = path.join(__dirname, '..');
const GLOBALS_DTS_PATH = path.join(ROOT, 'src/types/globals.d.ts');
const BOOTSTRAP_PATH   = path.join(ROOT, 'src/play/fullBootstrap.js');

// ── Parse globals.d.ts ───────────────────────────────────────────────────────

const dtsSrc = fs.readFileSync(GLOBALS_DTS_PATH, 'utf8');

const entries   = [];
const sectionRe = /^\s*\/\/\s*─+\s*(.*?)\s*─+/;
const declareRe = /^\s*declare\s+var\s+([A-Za-z_$][\w$]*)\s*:/;

for (const line of dtsSrc.split(/\r?\n/)) {
  const sec  = line.match(sectionRe);
  const decl = line.match(declareRe);
  if      (sec)  entries.push({ type: 'section', text: sec[1] });
  else if (decl) entries.push({ type: 'name',    name: decl[1] });
}

const names = entries.filter(e => e.type === 'name').map(e => e.name);
if (names.length === 0) throw new Error('generate-globals-dts: no declarations found in ' + GLOBALS_DTS_PATH);

// ── Deduplicate — keep last occurrence (typed beats untyped) ─────────────────

const seen = new Set();
const deduped = [];
// Walk entries in reverse so the LAST (typically typed) declaration wins.
for (let i = entries.length - 1; i >= 0; i--) {
  const e = entries[i];
  if (e.type === 'section') { deduped.push(e); continue; }
  if (seen.has(e.name)) continue;
  seen.add(e.name);
  deduped.push(e);
}
deduped.reverse();

const uniqueNames = [...new Set(names)];
if (uniqueNames.length < names.length) {
  console.log(`generate-globals-dts: deduplicated ${names.length - uniqueNames.length} duplicate declaration(s)`);
}

// ── Build replacement array body ─────────────────────────────────────────────

const lines = [];
for (const entry of deduped) {
  if (entry.type === 'section') {
    lines.push('');
    lines.push(`    // ── ${entry.text} ──`);
  } else {
    lines.push(`    '${entry.name}',`);
  }
}
// trim leading blank line
while (lines.length && lines[0].trim() === '') lines.shift();

// ── Patch VALIDATED_GLOBALS in fullBootstrap.js — globals.d.ts untouched ────

const bootstrapSrc = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');
const srcLines = bootstrapSrc.split(/\r?\n/);

const openIdx = srcLines.findIndex(l => /const VALIDATED_GLOBALS\s*=\s*Object\.freeze\(\[/.test(l));
if (openIdx === -1) throw new Error('generate-globals-dts: VALIDATED_GLOBALS open marker not found in ' + BOOTSTRAP_PATH);

const closeIdx = srcLines.findIndex((l, i) => i > openIdx && /^\s*\]\s*\)\s*;?\s*$/.test(l));
if (closeIdx === -1) throw new Error('generate-globals-dts: VALIDATED_GLOBALS close marker not found in ' + BOOTSTRAP_PATH);

const closeLine = srcLines[closeIdx]; // preserve original indentation/semicolon

const newSrcLines = [
  ...srcLines.slice(0, openIdx + 1),
  ...lines,
  closeLine,
  ...srcLines.slice(closeIdx + 1),
];

fs.writeFileSync(BOOTSTRAP_PATH, newSrcLines.join('\n'), 'utf8');
console.log(`generate-globals-dts: synced ${uniqueNames.length} globals from globals.d.ts → fullBootstrap.js`);
