// src/scripts/pipeline/check-registration-coherence.js
// Validates that conductor modules with functional registrations
// (registerDensityBias, registerTensionBias, registerFlickerModifier,
// registerRecorder, registerStateProvider) also call registerModule()
// for lifecycle resets. Without registerModule, state persists across
// section boundaries causing coherence decay.

'use strict';

const fs   = require('fs');
const path = require('path');
const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
function loadJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'src', 'output', 'metrics');

const SRC  = path.join(ROOT, 'src');

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

const FUNCTIONAL_REGISTRATIONS = [
  'registerDensityBias',
  'registerTensionBias',
  'registerFlickerModifier',
  'registerRecorder',
  'registerStateProvider',
];

// crossLayer modules use crossLayerRegistry for lifecycle, not conductorIntelligence.
// conductorSignalBridge is the only crossLayer module allowed to register a recorder
// (architectural exception) but its lifecycle is managed by crossLayerRegistry.
const EXCLUDED_FILES = new Set([
  'src/crossLayer/conductorSignalBridge.js',
]);

const allFiles = findJsFiles(SRC);
const orphans = [];
let totalFunctional = 0;
let totalWithModule = 0;

for (const filePath of allFiles) {
  const src = fs.readFileSync(filePath, 'utf8');
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (EXCLUDED_FILES.has(rel)) continue;

  const found = [];
  for (const reg of FUNCTIONAL_REGISTRATIONS) {
    const pattern = new RegExp(`conductorIntelligence\\.${reg}\\(`, 'g');
    if (pattern.test(src)) found.push(reg);
  }

  if (found.length === 0) continue;
  totalFunctional++;

  // Lifecycle-reset registration accepts EITHER form:
  //   1. conductorIntelligence.registerModule(...) -- explicit call
  //   2. conductorScopes: [...] manifest field -- declarative; the
  //      module loader binds the reset chain from the manifest. Used
  //      in newer modules (coherenceMonitor, signalTelemetry) that
  //      migrated from the explicit call. Both genuinely register the
  //      module for section-boundary reset; rejecting the manifest
  //      form as "missing registerModule" is a false positive.
  const hasRegisterModule = /conductorIntelligence\.registerModule\(/.test(src);
  const hasConductorScopes = /\bconductorScopes\s*:\s*\[/.test(src);
  if (hasRegisterModule || hasConductorScopes) {
    totalWithModule++;
  } else {
    orphans.push({ file: rel, registrations: found });
  }
}

// Output
const outputPath = path.join(METRICS_DIR, 'registration-coherence.json');
fs.writeFileSync(outputPath, JSON.stringify({
  meta: {
    script: 'check-registration-coherence.js',
    timestamp: new Date().toISOString(),
  },
  totalWithFunctionalRegistrations: totalFunctional,
  totalWithRegisterModule: totalWithModule,
  orphanCount: orphans.length,
  orphans: orphans.map(o => ({ file: o.file, missing: 'registerModule', has: o.registrations })),
}, null, 2) + '\n');

if (orphans.length > 0) {
  console.log(`check-registration-coherence: WARNING -- ${orphans.length} conductor modules have functional registrations without registerModule (no lifecycle reset):`);
  for (const o of orphans) {
    console.log(`  ${o.file}: has ${o.registrations.join(', ')} but no registerModule and no conductorScopes manifest field`);
  }
  console.log(`  Total: ${totalFunctional} modules with functional registrations, ${totalWithModule} have lifecycle-reset registration (registerModule OR conductorScopes manifest)`);
  console.log('  These modules will not reset state at section boundaries, potentially causing coherence decay.');
} else {
  console.log(`check-registration-coherence: PASS (${totalFunctional} modules, all have lifecycle-reset registration via registerModule or conductorScopes)`);
}
