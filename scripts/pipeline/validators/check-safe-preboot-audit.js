// scripts/pipeline/check-safe-preboot-audit.js
// Tracks safePreBoot.call() usage across the codebase to prevent debt growth.
// safePreBoot silently catches errors when globals aren't ready -- structurally
// equivalent to the || 0 pattern that Principle 2 (fail fast) prohibits.
// Legitimate uses: truly optional integrations (explainabilityBus, grandFinale
// telemetry snapshots). Everything else should use moduleLifecycle dependencies.
//
// This script:
//   1. Counts total safePreBoot.call() sites and files
//   2. Identifies the heaviest offenders (most calls per file)
//   3. Fails if the total exceeds the locked baseline (prevents growth)
//   4. Reports which boot-validated globals are being wrapped (likely bugs)

'use strict';

const fs   = require('fs');
const path = require('path');
const { ROOT, loadJson } = require('../hme/utils');
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'output', 'metrics');

const SRC  = path.join(ROOT, 'src');

// Baseline ratchets DOWN as the moduleLifecycle migration eliminates
// safePreBoot wraps that the registry now makes unnecessary.
// 171/59 -> 118/50 (initial migration; ~50 wraps stripped for 8 modules).
// 118/50 -> 19/16 (bulk migration: 245 modules declared; sweep_safepreboot.js
// stripped every wrap whose target name is now guaranteed-bound at boot).
// The remaining 19 wraps are legitimately-optional integrations
// (explainabilityBus telemetry, profileAdaptation hints) that may legitimately
// be absent on certain runs. Future migrations should continue ratcheting.
const BASELINE_CALLS = 19;
const BASELINE_FILES = 16;

function findJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

const allFiles = findJsFiles(SRC);
const perFile = [];
let totalCalls = 0;

for (const filePath of allFiles) {
  const src = fs.readFileSync(filePath, 'utf8');
  const matches = src.match(/safePreBoot\.call\(/g);
  if (!matches) continue;
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const count = matches.length;
  totalCalls += count;
  perFile.push({ file: rel, count });
}

perFile.sort((a, b) => b.count - a.count);
const totalFiles = perFile.length;

// Identify wrapped globals -- extract the function body inside safePreBoot.call(() => X.method(), ...)
const wrappedGlobals = new Map();
for (const filePath of allFiles) {
  const src = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  const re = /safePreBoot\.call\(\(\)\s*=>\s*(\w+)\./g;
  let match;
  while ((match = re.exec(src)) !== null) {
    const global = match[1];
    if (!wrappedGlobals.has(global)) wrappedGlobals.set(global, { count: 0, files: new Set() });
    const entry = wrappedGlobals.get(global);
    entry.count++;
    entry.files.add(rel);
  }
}

const topWrapped = [...wrappedGlobals.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 15)
  .map(([name, { count, files }]) => ({ global: name, calls: count, fileCount: files.size }));

// Output
const outputPath = path.join(METRICS_DIR, 'safe-preboot-audit.json');
fs.writeFileSync(outputPath, JSON.stringify({
  meta: {
    script: 'check-safe-preboot-audit.js',
    timestamp: new Date().toISOString(),
    baseline: { calls: BASELINE_CALLS, files: BASELINE_FILES },
  },
  totalCalls,
  totalFiles,
  topOffenders: perFile.slice(0, 10),
  topWrappedGlobals: topWrapped,
}, null, 2) + '\n');

// Report
const failures = [];

if (totalCalls > BASELINE_CALLS) {
  failures.push(
    `safePreBoot.call() count grew: ${totalCalls} calls (baseline: ${BASELINE_CALLS}). ` +
    'New calls must use moduleLifecycle.registerInitializer() dependencies instead.'
  );
}
if (totalFiles > BASELINE_FILES) {
  failures.push(
    `safePreBoot file count grew: ${totalFiles} files (baseline: ${BASELINE_FILES}). ` +
    'New files must not add safePreBoot -- declare proper dependencies.'
  );
}

console.log(`check-safe-preboot-audit: ${totalCalls} calls across ${totalFiles} files (baseline: ${BASELINE_CALLS}/${BASELINE_FILES})`);
console.log('  Top offenders:');
for (const { file, count } of perFile.slice(0, 5)) {
  console.log(`    ${file}: ${count} calls`);
}
console.log('  Most-wrapped globals (potential registerInitializer candidates):');
for (const { global: g, calls, fileCount } of topWrapped.slice(0, 5)) {
  console.log(`    ${g}: ${calls} calls across ${fileCount} files`);
}

if (failures.length > 0) {
  for (const f of failures) console.error('  FAIL: ' + f);
  console.error(`check-safe-preboot-audit: FAIL (${failures.length} failures)`);
  process.exit(1);
} else {
  console.log(`check-safe-preboot-audit: PASS (within baseline)`);
}
