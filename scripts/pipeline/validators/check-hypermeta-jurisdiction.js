// scripts/check-hypermeta-jurisdiction.js
// Pipeline check: detects manual axis floor/cap overrides that bypass the
// hypermeta self-calibrating controller infrastructure.
//
// Phase 1: Scans the SpecialCaps function in axisEnergyEquilibratorAxisAdjustments.js
//   for hardcoded threshold blocks. Compares against a declared allowlist.
//
// Phase 2: Scans all src/ files for direct .couplingMatrix reads outside the
//   coupling engine, meta-controllers, and pipeline plumbing. Modules that read
//   coupling matrix values and compute ad-hoc pressure formulas bypass the
//   hypermeta controller chain -- the same whack-a-mole antipattern.
//
// Phase 3: Bias registration bounds lock. Scans all src/ files for
//   conductorIntelligence.register{Density,Tension,Flicker}Bias calls and
//   compares (module, biasType, lo, hi) against a locked manifest.
//   Changing a module's registered bias range is the #1 whack-a-mole anti-pattern:
//   it widens the module's system-level influence instead of fixing the
//   controller chain that manages overall balance. Pipeline FAILS on any mismatch.
//   Manifest: scripts/bias-bounds-manifest.json
//   Update: node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds
//
// Phase 4: Controller-jurisdiction constant lock. Verifies specific module
//   constants that have been empirically identified as whack-a-mole targets
//   (R69-R74). These constants affect system-level metrics and should only
//   change when the responsible controller's logic is restructured.
//   Pipeline FAILS if any watched constant drifts from its locked value.
//
// Run: node scripts/check-hypermeta-jurisdiction.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');
const { ROOT, loadJson } = require('../hme/utils');

const SRC  = path.join(ROOT, 'src');

// -- Declared legacy overrides (allowlisted) --
// These are manual floors/caps that predate the hypermeta-first rule.
// Each entry tracks: axis, type, threshold, file, rationale for keeping.
// When a legacy override is removed, delete its entry here.
// NEVER add new entries -- fix the controller instead.
const LEGACY_OVERRIDES = [
  {
    id: 'tension-floor-0.15',
    axis: 'tension',
    type: 'floor',
    threshold: 0.15,
    rationale: 'LOAD-BEARING per R11 instrumentation: fires ~23x per 96-beat round. Catches tension axis at 0.15 before it drops to the generic 0.12 floor -- faster recovery at the shallower threshold. Not a removal candidate despite pre-hypermeta origin; the generic undershoot handler alone is insufficient.',
    pattern: /tensionSmoothed\s*<\s*0\.15/
  },
  {
    id: 'entropy-cap-0.19',
    axis: 'entropy',
    type: 'cap',
    threshold: 0.19,
    rationale: 'Removal candidate per R11 instrumentation: fires 0x in observed rounds. Entropy stays below 0.19 under current composition -- the cap never activates. Keep under observation for 5+ rounds before removal (legacy-override-chronically-zero invariant tracks this).',
    pattern: /entropySmoothed\s*>\s*0\.19/
  },
  {
    id: 'phase-trust-seesaw',
    axis: 'phase+trust',
    type: 'coordinated-cap',
    threshold: 0.08,
    rationale: 'Coordination layer with no generic equivalent. Suppresses trust when phase is starved (<0.08). May conflict with phaseFloorController (#14) and trustStarvationAutoNourishment (#5). Evaluate for refactoring into a cross-axis controller.',
    pattern: /phaseSmoothed\s*<\s*0\.08/
  },
  {
    id: 'phase-trust-seesaw-graduated-0.04',
    axis: 'phase',
    type: 'floor',
    threshold: 0.04,
    rationale: 'Sub-threshold within phase-trust seesaw graduated response. Moderate phase collapse triggers 1.05x trust threshold and 1.9x cap strength.',
    pattern: /phaseSmoothed\s*<\s*0\.04/
  },
  {
    id: 'phase-trust-seesaw-graduated-0.02',
    axis: 'phase',
    type: 'floor',
    threshold: 0.02,
    rationale: 'Sub-threshold within phase-trust seesaw graduated response. Deep phase collapse triggers 1.20x trust threshold and 2.4x cap strength.',
    pattern: /phaseSmoothed\s*<\s*0\.02/
  },
  {
    id: 'trust-floor-0.14',
    axis: 'trust',
    type: 'floor',
    threshold: 0.14,
    rationale: 'LOAD-BEARING per R11 instrumentation: fires ~25x per 96-beat round (57% of all trust-axis adjustments). Catches trust at 0.14 before it drops to 0.12 -- trustStarvationAutoNourishment (#5) alone is insufficient, it handles velocity but this handles absolute floor. Not a removal candidate.',
    pattern: /trustSmoothed\s*<\s*0\.14/
  }
];

// -- Detection --

function extractSpecialCapsSource() {
  const filePath = path.join(SRC, 'conductor/signal/balancing/axisEnergyEquilibratorAxisAdjustments.js');
  if (!fs.existsSync(filePath)) {
    throw new Error('check-hypermeta-jurisdiction: target file not found: ' + filePath);
  }
  const src = fs.readFileSync(filePath, 'utf8');

  // Extract the SpecialCaps function body
  const startMatch = src.match(/function\s+axisEnergyEquilibratorAxisAdjustmentsApplySpecialCaps\b/);
  if (!startMatch) {
    throw new Error('check-hypermeta-jurisdiction: could not find SpecialCaps function');
  }

  const startIndex = startMatch.index;
  // Find the matching closing brace by counting braces
  let braceDepth = 0;
  let foundOpen = false;
  let endIndex = startIndex;
  for (let i = startIndex; i < src.length; i++) {
    if (src[i] === '{') { braceDepth++; foundOpen = true; }
    if (src[i] === '}') { braceDepth--; }
    if (foundOpen && braceDepth === 0) { endIndex = i + 1; break; }
  }

  return src.substring(startIndex, endIndex);
}

function detectManualOverrides(specialCapsSrc) {
  // Detect hardcoded axis threshold patterns:
  // - <axis>Smoothed < <number>  (floor pattern)
  // - <axis>Smoothed > <number>  (cap pattern)
  // - phaseSmoothed < <number> && ... trustSmoothed (seesaw pattern)
  const thresholdPattern = /(\w+Smoothed)\s*([<>])\s*([\d.]+)/g;
  const found = [];
  let match;

  while ((match = thresholdPattern.exec(specialCapsSrc)) !== null) {
    const variable = match[1];
    const operator = match[2];
    const threshold = parseFloat(match[3]);
    const axis = variable.replace('Smoothed', '');
    const type = operator === '<' ? 'floor' : 'cap';

    // Skip very small thresholds (> 0.001 guards are not overrides)
    if (threshold < 0.01) continue;

    found.push({
      axis,
      type,
      threshold,
      rawMatch: match[0],
      index: match.index
    });
  }

  return found;
}

// -- Phase 2: Coupling matrix bypass detection --
// Scan all src/ files for direct .couplingMatrix reads outside the coupling engine,
// meta-controllers, and pipeline plumbing. Legacy violations are allowlisted.

const COUPLING_MATRIX_EXEMPT_PATHS = [
  'src/conductor/signal/balancing/',
  'src/conductor/signal/profiling/',
  'src/conductor/signal/meta/',
  'src/conductor/signal/output/',
  'src/play/main.js',
  'src/play/crossLayerBeatRecord.js',
  'src/play/processBeat.js',
  'src/writer/traceDrain.js'
];

const COUPLING_MATRIX_LEGACY = [
  { id: 'phaseLockedRhythmGenerator-coupling-read', file: 'src/rhythm/phaseLockedRhythmGenerator.js', rationale: 'Pre-R69 legacy. Reads 4 coupling pairs to compute rhythm pressure scalars. Should register a bias via conductorIntelligence instead.' },
  { id: 'conductorDampening-density-entropy', file: 'src/conductor/conductorDampening.js', rationale: 'Pre-R69 legacy. Reads density-entropy coupling for dampening decisions. Should use controller chain.' },
  { id: 'densityWaveAnalyzer-coupling-read', file: 'src/conductor/dynamics/densityWaveAnalyzer.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for wave analysis. Should register a bias via conductorIntelligence.' },
  { id: 'velocityShapeAnalyzer-coupling-read', file: 'src/conductor/dynamics/velocityShapeAnalyzer.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for velocity shaping. Should register a bias via conductorIntelligence.' },
  { id: 'dynamismEngine-coupling-read', file: 'src/conductor/dynamismEngine.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for dynamism decisions. Should use controller chain.' },
  { id: 'globalConductor-coupling-read', file: 'src/conductor/globalConductor.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for conductor decisions. Should use controller chain.' },
  { id: 'narrativeTrajectory-coupling-read', file: 'src/conductor/signal/narrative/narrativeTrajectory.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for narrative arc. Should register a bias via conductorIntelligence.' },
  { id: 'repetitionFatigueMonitor-coupling-read', file: 'src/conductor/texture/phrasing/repetitionFatigueMonitor.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for fatigue detection. Should register a bias via conductorIntelligence.' },
  { id: 'entropyRegulator-coupling-read', file: 'src/crossLayer/structure/entropy/entropyRegulator.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for entropy regulation. Should use controller chain.' },
  // R71 E1: adaptiveTrustScores coupling brake removed -- no longer a legacy violation
  { id: 'adaptiveTrustScoresHelpers-coupling-read', file: 'src/crossLayer/structure/trust/adaptiveTrustScoresHelpers.js', rationale: 'Pre-R69 legacy. Reads coupling matrix for coherence penalty formula. Should use controller chain.' }
];

function collectJsFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function detectCouplingMatrixBypasses() {
  const files = collectJsFiles(SRC);
  const couplingMatrixPattern = /\.couplingMatrix\b/;
  const violations = [];
  const legacyHits = [];

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (COUPLING_MATRIX_EXEMPT_PATHS.some(p => rel.includes(p))) continue;

    const src = fs.readFileSync(file, 'utf8');
    if (!couplingMatrixPattern.test(src)) continue;

    const isLegacy = COUPLING_MATRIX_LEGACY.some(l => rel.includes(l.file));
    if (isLegacy) {
      legacyHits.push(rel);
    } else {
      // Count occurrences for the report
      const matches = src.match(/\.couplingMatrix\b/g);
      violations.push({ file: rel, count: matches ? matches.length : 1 });
    }
  }

  return { violations, legacyHits };
}

// -- Phase 3: Bias registration bounds lock --
// Extract all conductorIntelligence.register{Density,Tension,Flicker}Bias calls
// from src/, capture (module, biasType, lo, hi), and compare against manifest.

const BIAS_MANIFEST_PATH = path.join(__dirname, 'bias-bounds-manifest.json');

const BIAS_REGISTRY_EXEMPT_PATHS = [
  'src/conductor/conductorIntelligence.js',
  'src/conductor/conductorIntelligenceModule/'
];

function extractBiasRegistrations() {
  const files = collectJsFiles(SRC);
  const result = [];
  const startPattern = /conductorIntelligence\.register(DensityBias|TensionBias|FlickerModifier)\s*\(/g;

  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    if (BIAS_REGISTRY_EXEMPT_PATHS.some(p => rel.includes(p))) continue;

    const src = fs.readFileSync(file, 'utf8');
    startPattern.lastIndex = 0;
    let match;

    while ((match = startPattern.exec(src)) !== null) {
      const biasKind = match[1];
      const callStart = match.index + match[0].length;

      // Find matching close paren by counting brace/paren depth
      let depth = 1;
      let endIdx = callStart;
      for (let i = callStart; i < src.length; i++) {
        if (src[i] === '(') depth++;
        if (src[i] === ')') { depth--; if (depth === 0) { endIdx = i; break; } }
      }

      const callBody = src.substring(callStart, endIdx);

      // Extract module name (first quoted string arg)
      const nameMatch = callBody.match(/^\s*'([^']+)'/);
      if (!nameMatch) continue;
      const moduleName = nameMatch[1];

      // Extract last two numeric args (lo, hi) before close paren
      const boundsMatch = callBody.match(/,\s*([\d.]+)\s*,\s*([\d.]+)\s*$/);
      if (!boundsMatch) continue;

      const biasType = biasKind === 'DensityBias' ? 'density'
        : biasKind === 'TensionBias' ? 'tension' : 'flicker';

      result.push({
        key: moduleName + ':' + biasType,
        module: moduleName,
        biasType,
        lo: parseFloat(boundsMatch[1]),
        hi: parseFloat(boundsMatch[2]),
        file: rel
      });
    }
  }

  return result;
}

function snapshotBiasManifest() {
  const regs = extractBiasRegistrations();
  const manifest = {};
  for (const r of regs) {
    manifest[r.key] = { lo: r.lo, hi: r.hi, file: r.file };
  }
  const data = {
    meta: {
      generated: new Date().toISOString(),
      description: 'Locked bias registration bounds. Any change causes pipeline failure.',
      updateCommand: 'node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds',
      registrationCount: regs.length
    },
    registrations: manifest
  };
  fs.writeFileSync(BIAS_MANIFEST_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log('check-hypermeta-jurisdiction: bias manifest snapshotted (' + regs.length + ' registrations) -> scripts/bias-bounds-manifest.json');
  return data;
}

function detectBiasBoundsViolations() {
  if (!fs.existsSync(BIAS_MANIFEST_PATH)) {
    return { violations: [], missing: [], added: [], noManifest: true };
  }

  const manifest = JSON.parse(fs.readFileSync(BIAS_MANIFEST_PATH, 'utf8'));
  const locked = manifest.registrations;
  const current = extractBiasRegistrations();

  const currentMap = {};
  for (const r of current) {
    currentMap[r.key] = r;
  }

  const violations = [];
  const missing = [];
  const added = [];

  // Check locked entries against current source
  for (const [key, expected] of Object.entries(locked)) {
    const actual = currentMap[key];
    if (!actual) {
      missing.push({ key, expected });
      continue;
    }
    if (actual.lo !== expected.lo || actual.hi !== expected.hi) {
      violations.push({
        key,
        expectedLo: expected.lo,
        expectedHi: expected.hi,
        actualLo: actual.lo,
        actualHi: actual.hi,
        file: actual.file
      });
    }
  }

  // Check for new registrations not in manifest
  for (const r of current) {
    if (!locked[r.key]) {
      added.push({ key: r.key, lo: r.lo, hi: r.hi, file: r.file });
    }
  }

  return { violations, missing, added, noManifest: false };
}

// -- Phase 4: Controller-jurisdiction constant lock --
// Specific module constants that affect system-level metrics and have been
// empirically identified as whack-a-mole targets (R69-R74). When a system
// metric (density variance, regime balance, exceedance) is off-target,
// the correct fix is the controller chain -- not these module constants.
// To change a locked constant, you must also modify the controlling controller
// and update WATCHED_CONSTANTS with the new value.

const WATCHED_CONSTANTS = [
  {
    id: 'regime-coherent-max-dwell',
    file: 'conductor/signal/profiling/regimeClassifier.js',
    pattern: /COHERENT_MAX_DWELL:\s*(\d+)/,
    expected: 75,
    controller: 'coherentThresholdScale self-balancer',
    rationale: 'Coherent share is managed by coherentThresholdScale auto-adjustment, not dwell caps. R74 changed 75->65, reverted.'
  },
  {
    id: 'criticality-density-gate',
    file: 'conductor/signal/meta/criticalityEngine.js',
    pattern: /densitySnap\s*<\s*([\d.]+)\)\s*return\s*1\.0/,
    expected: 0.52,
    controller: 'criticalityEngine self-calibrating threshold',
    rationale: 'SOC density gate determines when avalanches modulate density. R67 set to 0.52 based on density product avg. R74 changed to 0.45, reverted.'
  },
  {
    id: 'criticality-tension-gate',
    file: 'conductor/signal/meta/criticalityEngine.js',
    pattern: /tensionSnap\s*<\s*([\d.]+)\)\s*return\s*1\.0/,
    expected: 0.85,
    controller: 'criticalityEngine self-calibrating threshold',
    rationale: 'SOC tension gate determines when avalanches modulate tension. R73 set to 0.85 based on tension avg. Structural; not a tuning knob.'
  },
  {
    id: 'climax-receding-density-pullback',
    file: 'conductor/dynamics/climaxProximityPredictor.js',
    pattern: /\*\s*0\.24\s*,\s*0\s*,\s*([\d.]+)\)/,
    expected: 0.12,
    controller: 'density axis coupling controllers',
    rationale: 'Receding density pullback affects system density variance. R74 changed 0.12->0.08, reverted. Density recovery is controller responsibility.'
  },
  {
    id: 'section-boundary-relief-window',
    file: 'crossLayer/structure/form/sectionIntentCurves.js',
    pattern: /p\s*\/\s*([\d.]+)\)\s*\*\s*reliefDepth/,
    expected: 0.08,
    controller: 'density variance axis controllers',
    rationale: 'Section boundary relief window affects density variance. R74 changed 0.08->0.12, reverted. Density contrast is controller responsibility.'
  }
];

function detectWatchedConstantViolations() {
  const violations = [];

  for (const entry of WATCHED_CONSTANTS) {
    const filePath = path.join(SRC, entry.file);
    if (!fs.existsSync(filePath)) {
      violations.push({ id: entry.id, error: 'file not found: ' + entry.file });
      continue;
    }

    const src = fs.readFileSync(filePath, 'utf8');
    const match = src.match(entry.pattern);
    if (!match) {
      violations.push({ id: entry.id, error: 'pattern not found in ' + entry.file });
      continue;
    }

    const actual = parseFloat(match[1]);
    if (actual !== entry.expected) {
      violations.push({
        id: entry.id,
        file: entry.file,
        expected: entry.expected,
        actual,
        controller: entry.controller,
        rationale: entry.rationale
      });
    }
  }

  return violations;
}

// -- Main --

function main() {
  // Handle --snapshot-bias-bounds flag
  if (process.argv.includes('--snapshot-bias-bounds')) {
    snapshotBiasManifest();
    return;
  }

  // === Phase 1: SpecialCaps overrides ===
  const specialCapsSrc = extractSpecialCapsSource();
  const detected = detectManualOverrides(specialCapsSrc);

  // Check each detected override against the allowlist. Track which legacy id
  // matched so we can report per-id occurrence counts (call-site multiplicity
  // is useful: e.g. phaseSmoothed < 0.02 appearing 3x = 3 call sites that
  // depend on the override, each a future migration point).
  const unregistered = [];
  const registered = [];
  const registeredByLegacyId = {};

  for (const override of detected) {
    const matchedLegacy = LEGACY_OVERRIDES.find(legacy => legacy.pattern.test(override.rawMatch));
    if (matchedLegacy) {
      override.legacyId = matchedLegacy.id;
      registered.push(override);
      registeredByLegacyId[matchedLegacy.id] = (registeredByLegacyId[matchedLegacy.id] || 0) + 1;
    } else {
      unregistered.push(override);
    }
  }
  const registeredUnique = Object.keys(registeredByLegacyId).length;

  // Verify all allowlisted overrides still exist (detect removals to update allowlist)
  const removedLegacy = [];
  for (const legacy of LEGACY_OVERRIDES) {
    if (!legacy.pattern.test(specialCapsSrc)) {
      removedLegacy.push(legacy);
    }
  }

  // === Phase 2: Coupling matrix bypasses ===
  const { violations: matrixViolations, legacyHits: matrixLegacy } = detectCouplingMatrixBypasses();

  // === Phase 3: Bias registration bounds lock ===
  const biasResult = detectBiasBoundsViolations();

  // === Phase 4: Watched constant lock ===
  const watchedViolations = detectWatchedConstantViolations();

  // Write results
  const outputPath = path.join(ROOT, 'metrics', 'hypermeta-jurisdiction.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated: new Date().toISOString(),
      legacyAllowlistSize: LEGACY_OVERRIDES.length,
      detectedOverrides: detected.length,
      registeredUnique: registeredUnique,
      unregisteredOverrides: unregistered.length,
      removedLegacy: removedLegacy.length,
      couplingMatrixViolations: matrixViolations.length,
      couplingMatrixLegacy: matrixLegacy.length,
      biasManifestPresent: !biasResult.noManifest,
      biasBoundsViolations: biasResult.violations.length,
      biasBoundsMissing: biasResult.missing.length,
      biasBoundsAdded: biasResult.added.length,
      watchedConstantViolations: watchedViolations.length,
      watchedConstantCount: WATCHED_CONSTANTS.length
    },
    registered: registered.map(o => ({ axis: o.axis, type: o.type, threshold: o.threshold, legacyId: o.legacyId })),
    registeredByLegacyId: registeredByLegacyId,
    unregistered: unregistered.map(o => ({ axis: o.axis, type: o.type, threshold: o.threshold, rawMatch: o.rawMatch })),
    removedLegacy: removedLegacy.map(l => ({ id: l.id, axis: l.axis })),
    legacyOverrides: LEGACY_OVERRIDES.map(l => ({ id: l.id, axis: l.axis, type: l.type, threshold: l.threshold, rationale: l.rationale })),
    couplingMatrixViolations: matrixViolations,
    couplingMatrixLegacy: matrixLegacy.map(f => ({ file: f })),
    couplingMatrixLegacyAllowlist: COUPLING_MATRIX_LEGACY,
    biasBoundsViolations: biasResult.violations,
    biasBoundsMissing: biasResult.missing,
    biasBoundsAdded: biasResult.added,
    watchedConstantViolations: watchedViolations,
    watchedConstants: WATCHED_CONSTANTS.map(w => ({ id: w.id, file: w.file, expected: w.expected, controller: w.controller }))
  }, null, 2), 'utf8');

  // Report
  if (removedLegacy.length > 0) {
    console.warn(
      'check-hypermeta-jurisdiction: ' + removedLegacy.length +
      ' allowlisted override(s) no longer found in source (update LEGACY_OVERRIDES): ' +
      removedLegacy.map(l => l.id).join(', ')
    );
  }

  if (unregistered.length > 0) {
    const details = unregistered.map(o => o.axis + ' ' + o.type + ' at ' + o.threshold).join('; ');
    throw new Error(
      'check-hypermeta-jurisdiction: FAIL - ' + unregistered.length +
      ' unregistered manual override(s) detected in SpecialCaps: ' + details +
      '. Fix the hypermeta controller instead of adding hardcoded thresholds. ' +
      'See metrics/hypermeta-jurisdiction.json and journal.md R5 for rationale.'
    );
  }

  if (matrixViolations.length > 0) {
    const details = matrixViolations.map(v => v.file + ' (' + v.count + ' reads)').join('; ');
    throw new Error(
      'check-hypermeta-jurisdiction: FAIL - ' + matrixViolations.length +
      ' file(s) read .couplingMatrix outside the coupling engine: ' + details +
      '. Register a bias via conductorIntelligence and let hypermeta controllers manage the response. ' +
      'See metrics/hypermeta-jurisdiction.json.'
    );
  }

  // Phase 3 enforcement
  if (biasResult.noManifest) {
    console.warn(
      'check-hypermeta-jurisdiction: WARNING - no bias-bounds manifest found. ' +
      'Run: node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds'
    );
  } else {
    if (biasResult.violations.length > 0) {
      const details = biasResult.violations.map(v =>
        v.key + ': [' + v.expectedLo + ',' + v.expectedHi + '] -> [' + v.actualLo + ',' + v.actualHi + '] in ' + v.file
      ).join('; ');
      throw new Error(
        'check-hypermeta-jurisdiction: FAIL - ' + biasResult.violations.length +
        ' bias registration bound(s) changed: ' + details +
        '. Changing bias bounds is a whack-a-mole anti-pattern. Fix the controller chain instead. ' +
        'If this is a legitimate structural change, update the manifest: ' +
        'node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds'
      );
    }
    if (biasResult.added.length > 0) {
      const details = biasResult.added.map(a => a.key + ' [' + a.lo + ',' + a.hi + '] in ' + a.file).join('; ');
      throw new Error(
        'check-hypermeta-jurisdiction: FAIL - ' + biasResult.added.length +
        ' new bias registration(s) not in manifest: ' + details +
        '. Add to manifest: node scripts/check-hypermeta-jurisdiction.js --snapshot-bias-bounds'
      );
    }
    if (biasResult.missing.length > 0) {
      console.warn(
        'check-hypermeta-jurisdiction: WARNING - ' + biasResult.missing.length +
        ' manifest entries not found in source (modules removed?): ' +
        biasResult.missing.map(m => m.key).join(', ')
      );
    }
  }

  // Phase 4 enforcement
  if (watchedViolations.length > 0) {
    const details = watchedViolations.map(v =>
      v.id + (v.error ? ': ' + v.error : ': expected ' + v.expected + ', got ' + v.actual + ' in ' + v.file + ' (controller: ' + v.controller + ')')
    ).join('; ');
    throw new Error(
      'check-hypermeta-jurisdiction: FAIL - ' + watchedViolations.length +
      ' watched constant(s) changed: ' + details +
      '. These constants affect system-level metrics and are under controller jurisdiction. ' +
      'Fix the controller chain instead of hand-tuning the constant. ' +
      'If this is a legitimate structural change, update WATCHED_CONSTANTS in this script.'
    );
  }

  const legacyTotal = registered.length + matrixLegacy.length;
  const biasStatus = biasResult.noManifest ? ', bias manifest missing' : ', ' + Object.keys(JSON.parse(fs.readFileSync(BIAS_MANIFEST_PATH, 'utf8')).registrations).length + ' bias bounds locked';
  console.log(
    'check-hypermeta-jurisdiction: PASS (' +
    legacyTotal + ' legacy violation(s) allowlisted, 0 new' + biasStatus +
    ', ' + WATCHED_CONSTANTS.length + ' watched constants verified) -> metrics/hypermeta-jurisdiction.json'
  );
}

main();
