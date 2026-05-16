'use strict';
// Auto-generates the manifest-derived section of src/types/globals.d.ts.
// extracts the `provides` array, and emits `declare var NAME: any;` lines
// between two marker comments. Hand-edited declarations stay above the
// start marker; manifest-derived ones live inside the markers.
//
// The single source of truth for declared modules is now the manifest --
// adding `provides: ['foo']` to a manifest is enough; this generator
// keeps globals.d.ts in sync. Drift verifier (check-manifest-globals.js)
// fails CI if a manifest is added without re-running this generator.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'src');
const DTS = path.join(ROOT, 'src/types/globals.d.ts');

const START_MARKER = '// === AUTO-GENERATED FROM MANIFESTS (moduleLifecycle.declare) -- do not hand-edit below this line ===';
const END_MARKER = '// === END AUTO-GENERATED ===';
// Match any prior block (handles legacy em-dash variants (U+2014) plus ASCII `--`)
// so re-runs cleanly REPLACE rather than append duplicate sections.
const BLOCK_RE = /\n*\/\/ === AUTO-GENERATED FROM MANIFESTS \(moduleLifecycle\.declare\)[^\n]*===\n[\s\S]*?\n\/\/ === END AUTO-GENERATED ===\n?/g;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.js')) out.push(full);
  }
}

function extractProvides(src) {
  const provides = new Set();
  const declareRe = /moduleLifecycle\.declare\(\{[^]*?provides:\s*\[([^\]]+)\][^]*?\}\);/g;
  let match;
  while ((match = declareRe.exec(src)) !== null) {
    const arrText = match[1];
    const names = arrText.split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    for (const n of names) provides.add(n);
  }
  return provides;
}

function gather() {
  const files = [];
  walk(SRC, files);
  const all = new Set();
  let manifestCount = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const p = extractProvides(src);
    if (p.size > 0) manifestCount++;
    for (const n of p) all.add(n);
  }
  return { names: [...all].sort(), manifestCount };
}

function rewriteDts(names) {
  const dtsSrc = fs.readFileSync(DTS, 'utf8');
  const block = [
    START_MARKER,
    `// ${names.length} manifest-derived globals (regenerate via: node scripts/pipeline/generators/generate-manifest-globals.js)`,
    ...names.map(n => `declare var ${n}: any;`),
    END_MARKER,
  ].join('\n');

  // Strip ALL existing auto-generated blocks (legacy em-dash + ASCII variants),
  // then append exactly one fresh block. Idempotent across reruns.
  const stripped = dtsSrc.replace(BLOCK_RE, '\n').replace(/\n{3,}$/, '\n\n');
  const updated = stripped.replace(/\s+$/, '') + '\n\n' + block + '\n';
  if (updated !== dtsSrc) {
    fs.writeFileSync(DTS, updated);
    return true;
  }
  return false;
}

function main() {
  const { names, manifestCount } = gather();
  const changed = rewriteDts(names);
  console.log(`generate-manifest-globals: ${manifestCount} manifests, ${names.length} provides ${changed ? '(rewrote globals.d.ts)' : '(no change)'}`);
}

main();
