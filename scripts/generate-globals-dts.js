// scripts/generate-globals-dts.js
// Generates src/types/validated-globals.d.ts from VALIDATED_GLOBALS in fullBootstrap.js,
// then strips the now-redundant `declare var NAME: any;` lines from globals.d.ts.
// Run automatically at the start of `npm run main`.

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BOOTSTRAP_PATH = path.join(ROOT, 'src/play/fullBootstrap.js');
const GLOBALS_DTS_PATH = path.join(ROOT, 'src/types/globals.d.ts');
const OUT_PATH = path.join(ROOT, 'src/types/validated-globals.d.ts');

// Hand-maintained typed overrides — non-`any` types for specific validated globals.
// All other validated globals receive `any`.
const TYPED_OVERRIDES = {
  getMeterPair:        '{ pick: () => void; reset: () => void }',
  setFeedbackPitchBias:'(bias: number) => void',
  setClimaxMods:       '(mods: { playProbScale: number, velocityScale: number, registerBias: number, entropyTarget: number }) => void',
};

// ── Parse VALIDATED_GLOBALS from fullBootstrap.js ────────────────────────────

const bootstrapSrc = fs.readFileSync(BOOTSTRAP_PATH, 'utf8');

const arrayMatch = bootstrapSrc.match(/const VALIDATED_GLOBALS\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\s*\)/);
if (!arrayMatch) {
  throw new Error('generate-globals-dts: could not find VALIDATED_GLOBALS array in ' + BOOTSTRAP_PATH);
}
const arrayBody = arrayMatch[1];

// Each entry is either a section comment `// ── name ──` or a quoted name `'Foo'`
const entries = [];
for (const line of arrayBody.split('\n')) {
  const sectionMatch = line.match(/\/\/\s*─+\s*(.*?)\s*─+/);
  const nameMatch    = line.match(/'([A-Za-z_$][\w$]*)'/);
  if (sectionMatch) entries.push({ type: 'section', text: sectionMatch[1].trim() });
  else if (nameMatch) entries.push({ type: 'name', name: nameMatch[1] });
}

const validatedNames = new Set(entries.filter(e => e.type === 'name').map(e => e.name));

// ── Write validated-globals.d.ts ─────────────────────────────────────────────

const outLines = [
  '// src/types/validated-globals.d.ts',
  '// AUTO-GENERATED — do not edit by hand.',
  '// Source of truth: VALIDATED_GLOBALS in src/play/fullBootstrap.js',
  '// Regenerate: node scripts/generate-globals-dts.js  (runs automatically via npm run main)',
  '',
];

for (const entry of entries) {
  if (entry.type === 'section') {
    outLines.push('');
    outLines.push(`// ── ${entry.text} ──`);
  } else {
    const type = TYPED_OVERRIDES[entry.name] || 'any';
    outLines.push(`declare var ${entry.name}: ${type};`);
  }
}
outLines.push('');

fs.writeFileSync(OUT_PATH, outLines.join('\n'), 'utf8');
console.log(`generate-globals-dts: wrote ${validatedNames.size} declarations → ${path.relative(ROOT, OUT_PATH)}`);

// ── Strip now-redundant `declare var NAME: any;` lines from globals.d.ts ─────

const globalsSrc = fs.readFileSync(GLOBALS_DTS_PATH, 'utf8');
const simpleAnyDecl = /^declare var ([A-Za-z_$][\w$]*):\s*any;$/;

const newLines = globalsSrc.split('\n').filter(line => {
  const m = line.match(simpleAnyDecl);
  return !(m && validatedNames.has(m[1]));
});

// Collapse consecutive blank lines left by removals (max 1 blank line in a row)
const collapsed = [];
let prevBlank = false;
for (const line of newLines) {
  const blank = line.trim() === '';
  if (blank && prevBlank) continue;
  collapsed.push(line);
  prevBlank = blank;
}

const newGlobalsSrc = collapsed.join('\n');
if (newGlobalsSrc !== globalsSrc) {
  fs.writeFileSync(GLOBALS_DTS_PATH, newGlobalsSrc, 'utf8');
  console.log(`generate-globals-dts: cleaned redundant any-declarations from ${path.relative(ROOT, GLOBALS_DTS_PATH)}`);
} else {
  console.log(`generate-globals-dts: globals.d.ts already clean`);
}
