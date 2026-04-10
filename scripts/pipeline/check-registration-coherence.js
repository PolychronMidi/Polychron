// scripts/pipeline/check-registration-coherence.js
// Validates that conductor modules with functional registrations
// (registerDensityBias, registerTensionBias, registerFlickerModifier,
// registerRecorder, registerStateProvider) also call registerModule()
// for lifecycle resets. Without registerModule, state persists across
// section boundaries causing coherence decay.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
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

  const hasRegisterModule = /conductorIntelligence\.registerModule\(/.test(src);
  if (hasRegisterModule) {
    totalWithModule++;
  } else {
    orphans.push({ file: rel, registrations: found });
  }
}

// Output
const outputPath = path.join(ROOT, 'metrics', 'registration-coherence.json');
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
    console.log(`  ${o.file}: has ${o.registrations.join(', ')} but no registerModule`);
  }
  console.log(`  Total: ${totalFunctional} modules with functional registrations, ${totalWithModule} also have registerModule`);
  console.log('  These modules will not reset state at section boundaries, potentially causing coherence decay.');
} else {
  console.log(`check-registration-coherence: PASS (${totalFunctional} modules, all have registerModule)`);
}
