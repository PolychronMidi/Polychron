// scripts/check-manifest-health.js
// Enforce machine-readable health gates from output/system-manifest.json.

'use strict';

const fs = require('fs');
const path = require('path');

function parseFiniteEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`check-manifest-health: ${name} must be a finite number (received "${raw}")`);
  }
  return n;
}

function loadManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`check-manifest-health: missing manifest at ${filePath}`);
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`check-manifest-health: failed to parse manifest: ${err && err.message ? err.message : err}`);
  }
}

function getNested(obj, keys, label) {
  let cur = obj;
  for (let i = 0; i < keys.length; i++) {
    cur = cur && typeof cur === 'object' ? cur[keys[i]] : undefined;
  }
  if (cur === undefined || cur === null) {
    throw new Error(`check-manifest-health: missing required field ${label}`);
  }
  return cur;
}

function assertManifestHealth(manifest) {
  const MAX_DENSITY_LOW_RATE = parseFiniteEnv('MANIFEST_MAX_DENSITY_LOW_RATE', 0.12);
  const MAX_COMPOSITIONAL_COUPLING = parseFiniteEnv('MANIFEST_MAX_COMPOSITIONAL_COUPLING', 0.75);
  const MAX_WARNING_COUNT = parseFiniteEnv('MANIFEST_MAX_WARNING_COUNT', 10);

  const densityLowRate = Number(getNested(manifest, ['pipelineNormalizer', 'density', 'compressedLowRate'], 'pipelineNormalizer.density.compressedLowRate'));
  if (!Number.isFinite(densityLowRate)) {
    throw new Error('check-manifest-health: compressedLowRate must be finite');
  }

  const couplingMatrix = getNested(manifest, ['systemDynamics', 'snapshot', 'couplingMatrix'], 'systemDynamics.snapshot.couplingMatrix');
  if (!couplingMatrix || typeof couplingMatrix !== 'object') {
    throw new Error('check-manifest-health: couplingMatrix must be an object');
  }

  const compositionalPairs = [
    'density-tension',
    'density-flicker',
    'density-entropy',
    'tension-flicker',
    'tension-entropy',
    'flicker-entropy'
  ];

  const excessivePairs = [];
  for (let i = 0; i < compositionalPairs.length; i++) {
    const pair = compositionalPairs[i];
    const corr = Number(couplingMatrix[pair]);
    if (!Number.isFinite(corr)) continue;
    if (Math.abs(corr) > MAX_COMPOSITIONAL_COUPLING) {
      excessivePairs.push(`${pair}=${corr.toFixed(3)}`);
    }
  }

  const verdicts = Array.isArray(manifest.coherenceVerdicts) ? manifest.coherenceVerdicts : [];
  let warningCount = 0;
  const criticalFindings = [];

  for (let i = 0; i < verdicts.length; i++) {
    const v = verdicts[i] || {};
    const sev = String(v.severity || '').toLowerCase();
    if (sev === 'warning') warningCount++;
    if (sev === 'critical') {
      criticalFindings.push(String(v.finding || 'critical finding'));
    }
  }

  const failures = [];

  if (densityLowRate > MAX_DENSITY_LOW_RATE) {
    failures.push(
      `density compressedLowRate ${densityLowRate.toFixed(3)} exceeds ${MAX_DENSITY_LOW_RATE.toFixed(3)}`
    );
  }

  if (excessivePairs.length > 0) {
    failures.push(
      `compositional coupling exceeds threshold ${MAX_COMPOSITIONAL_COUPLING.toFixed(3)}: ${excessivePairs.join(', ')}`
    );
  }

  if (warningCount > MAX_WARNING_COUNT) {
    failures.push(`coherence warning count ${warningCount} exceeds ${MAX_WARNING_COUNT}`);
  }

  if (criticalFindings.length > 0) {
    failures.push(`critical coherence verdicts present: ${criticalFindings.join(' | ')}`);
  }

  if (failures.length > 0) {
    throw new Error('check-manifest-health: health gate failed: ' + failures.join('; '));
  }

  console.log(
    'check-manifest-health: PASS ' +
    `(densityLowRate=${densityLowRate.toFixed(3)}, warningCount=${warningCount}, max|coupling|<=${MAX_COMPOSITIONAL_COUPLING.toFixed(3)})`
  );
}

function main() {
  const manifestPath = path.join(process.cwd(), 'output', 'system-manifest.json');
  const manifest = loadManifest(manifestPath);
  assertManifestHealth(manifest);
}

main();
