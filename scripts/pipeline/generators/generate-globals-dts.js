// scripts/generate-globals-dts.js
// Single source of truth: src/types/globals.d.ts
// Reads every `declare var NAME:` entry (preserving section comments) and
// rewrites the VALIDATED_GLOBALS array in src/play/fullBootstrap.js.
// Run automatically at the start of `npm run main` - adding a global now only
// requires editing globals.d.ts.
// globals.d.ts is never modified by this script.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT             = path.join(__dirname, '..', '..', '..');
const GLOBALS_DTS_PATH = path.join(ROOT, 'src/types/globals.d.ts');
const BOOTSTRAP_PATH   = path.join(ROOT, 'src/play/fullBootstrap.js');

// -- Parse globals.d.ts -

const dtsSrc = fs.readFileSync(GLOBALS_DTS_PATH, 'utf8');

const entries   = [];
const sectionRe = /^\s*\/\/\s*-+\s*(.*?)\s*-+/;
const declareRe = /^\s*declare\s+var\s+([A-Za-z_$][\w$]*)\s*:/;
const advisoryRe = /@boot-advisory/;

let nextIsAdvisory = false;
for (const line of dtsSrc.split(/\r?\n/)) {
  // Check for @boot-advisory in JSDoc comment preceding a declaration
  if (advisoryRe.test(line)) {
    nextIsAdvisory = true;
    // If this line also has a declare var on it (single-line JSDoc), don't skip
    const declOnSameLine = line.match(declareRe);
    if (!declOnSameLine) continue;
  }
  const sec  = line.match(sectionRe);
  const decl = line.match(declareRe);
  if      (sec)  { entries.push({ type: 'section', text: sec[1] }); nextIsAdvisory = false; }
  else if (decl) { entries.push({ type: 'name', name: decl[1], advisory: nextIsAdvisory }); nextIsAdvisory = false; }
}

const names = entries.filter(e => e.type === 'name').map(e => e.name);
if (names.length === 0) throw new Error('generate-globals-dts: no declarations found in ' + GLOBALS_DTS_PATH);

// -- Deduplicate - keep last occurrence (typed beats untyped) --

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
  console.log(`generate-globals-dts: deduplicated ${names.length - uniqueNames.length} duplicate declaration(s): ${[...seen].filter(n => names.indexOf(n) !== names.lastIndexOf(n)).join(', ')}`);
}

// -- Build replacement array body
// Separate critical globals from advisory (warn-only) globals

const criticalLines = [];
const advisoryLines = [];
for (const entry of deduped) {
  if (entry.type === 'section') {
    criticalLines.push('');
    criticalLines.push(`    // -- ${entry.text} --`);
    advisoryLines.push('');
    advisoryLines.push(`    // -- ${entry.text} --`);
  } else if (entry.advisory) {
    advisoryLines.push(`    '${entry.name}',`);
  } else {
    criticalLines.push(`    '${entry.name}',`);
  }
}
// trim leading blank lines
while (criticalLines.length && criticalLines[0].trim() === '') criticalLines.shift();
while (advisoryLines.length && advisoryLines[0].trim() === '') advisoryLines.shift();
// Remove empty section-only groups from advisory
const cleanedAdvisory = [];
for (let i = 0; i < advisoryLines.length; i++) {
  const line = advisoryLines[i];
  const isComment = line.trim().startsWith('//') || line.trim() === '';
  if (isComment) {
    // Only keep comment if next non-empty line is a quoted name
    let hasContent = false;
    for (let j = i + 1; j < advisoryLines.length; j++) {
      const next = advisoryLines[j].trim();
      if (next === '' || next.startsWith('//')) continue;
      if (next.startsWith("'")) hasContent = true;
      break;
    }
    if (hasContent) cleanedAdvisory.push(line);
  } else {
    cleanedAdvisory.push(line);
  }
}

const advisoryCount = deduped.filter(e => e.type === 'name' && e.advisory).length;
const criticalCount = uniqueNames.length - advisoryCount;

// -- Patch VALIDATED_GLOBALS and ADVISORY_GLOBALS in fullBootstrap.js -

const bootstrapSrc = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');
const srcLines = bootstrapSrc.split(/\r?\n/);

const openIdx = srcLines.findIndex(l => /const VALIDATED_GLOBALS\s*=\s*Object\.freeze\(\[/.test(l));
if (openIdx === -1) throw new Error('generate-globals-dts: VALIDATED_GLOBALS open marker not found in ' + BOOTSTRAP_PATH);

const closeIdx = srcLines.findIndex((l, i) => i > openIdx && /^\s*\]\s*\)\s*;?\s*$/.test(l));
if (closeIdx === -1) throw new Error('generate-globals-dts: VALIDATED_GLOBALS close marker not found in ' + BOOTSTRAP_PATH);

const closeLine = srcLines[closeIdx]; // preserve original indentation/semicolon

// Check if ADVISORY_GLOBALS already exists
const advisoryOpenIdx = srcLines.findIndex(l => /const ADVISORY_GLOBALS\s*=\s*Object\.freeze\(\[/.test(l));
let advisoryCloseIdx = -1;
if (advisoryOpenIdx !== -1) {
  advisoryCloseIdx = srcLines.findIndex((l, i) => i > advisoryOpenIdx && /^\s*\]\s*\)\s*;?\s*$/.test(l));
}

let newSrcLines;
if (advisoryOpenIdx !== -1 && advisoryCloseIdx !== -1) {
  // Replace both existing arrays
  // Build from bottom up to avoid index shifting
  const afterAdvisory = srcLines.slice(advisoryCloseIdx + 1);
  const betweenArrays = srcLines.slice(closeIdx + 1, advisoryOpenIdx);
  newSrcLines = [
    ...srcLines.slice(0, openIdx + 1),
    ...criticalLines,
    closeLine,
    ...betweenArrays,
    srcLines[advisoryOpenIdx], // keep the const ADVISORY_GLOBALS = Object.freeze([ line
    ...cleanedAdvisory,
    closeLine,
    ...afterAdvisory
  ];
} else {
  // First time: insert ADVISORY_GLOBALS after VALIDATED_GLOBALS
  newSrcLines = [
    ...srcLines.slice(0, openIdx + 1),
    ...criticalLines,
    closeLine,
    '',
    '  /** @type {readonly string[]} Advisory globals: warn if missing, do not throw. */',
    '  const ADVISORY_GLOBALS = Object.freeze([',
    ...cleanedAdvisory,
    '  ]);',
    ...srcLines.slice(closeIdx + 1),
  ];
}

fs.writeFileSync(BOOTSTRAP_PATH, newSrcLines.join('\n'), 'utf8');
console.log(`generate-globals-dts: synced ${criticalCount} critical + ${advisoryCount} advisory globals from globals.d.ts -> fullBootstrap.js`);
