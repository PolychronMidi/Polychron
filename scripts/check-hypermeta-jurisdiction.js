// scripts/check-hypermeta-jurisdiction.js
// Pipeline check: detects manual axis floor/cap overrides that bypass the
// hypermeta self-calibrating controller infrastructure.
//
// The axisEnergyEquilibrator (#13) has a generic axis loop that handles all
// axes via AXIS_OVERSHOOT (0.22) and AXIS_UNDERSHOOT (0.12). Adding manual
// floors/caps in the SpecialCaps section is a "whack-a-mole" antipattern
// that duplicates or conflicts with the generic handler and the 16 hypermeta
// controllers that already manage coupling, regime, trust, phase, entropy,
// and flicker dynamics.
//
// This script:
// 1. Scans the SpecialCaps function for hardcoded threshold blocks
// 2. Compares against a declared allowlist of legacy overrides
// 3. FAILS if new manual overrides are added without updating the allowlist
// 4. WARNS about existing legacy overrides (to track removal progress)
//
// To fix a controller deficiency, modify the controller logic itself (e.g.,
// phaseFloorController, entropyAmplificationController, the generic axis
// loop's giniMult/dampMult), not a hardcoded threshold in SpecialCaps.
//
// Run: node scripts/check-hypermeta-jurisdiction.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
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
    rationale: 'Pre-hypermeta legacy. Generic undershoot at 0.12 is 0.03 below; tension floor at 0.15 with 2.5x rate provides faster recovery. Candidate for removal once giniMult proves sufficient.',
    pattern: /tensionSmoothed\s*<\s*0\.15/
  },
  {
    id: 'entropy-cap-0.19',
    axis: 'entropy',
    type: 'cap',
    threshold: 0.19,
    rationale: 'Pre-hypermeta legacy. Generic overshoot at 0.22 is 0.03 above; entropy cap at 0.19 with 2.5x rate prevents entropy domination. Candidate for removal once giniMult proves sufficient.',
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
    rationale: 'Post-R6 legacy with R3 rate adjustment (1.20x). Generic undershoot at 0.12 is 0.02 below. trustStarvationAutoNourishment (#5) handles velocity-based recovery. Candidate for removal.',
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

// -- Main --

function main() {
  const specialCapsSrc = extractSpecialCapsSource();
  const detected = detectManualOverrides(specialCapsSrc);

  // Check each detected override against the allowlist
  const unregistered = [];
  const registered = [];

  for (const override of detected) {
    const isAllowlisted = LEGACY_OVERRIDES.some(legacy => legacy.pattern.test(override.rawMatch));
    if (isAllowlisted) {
      registered.push(override);
    } else {
      unregistered.push(override);
    }
  }

  // Verify all allowlisted overrides still exist (detect removals to update allowlist)
  const removedLegacy = [];
  for (const legacy of LEGACY_OVERRIDES) {
    if (!legacy.pattern.test(specialCapsSrc)) {
      removedLegacy.push(legacy);
    }
  }

  // Write results
  const outputPath = path.join(ROOT, 'metrics', 'hypermeta-jurisdiction.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    meta: {
      generated: new Date().toISOString(),
      legacyAllowlistSize: LEGACY_OVERRIDES.length,
      detectedOverrides: detected.length,
      unregisteredOverrides: unregistered.length,
      removedLegacy: removedLegacy.length
    },
    registered: registered.map(o => ({ axis: o.axis, type: o.type, threshold: o.threshold })),
    unregistered: unregistered.map(o => ({ axis: o.axis, type: o.type, threshold: o.threshold, rawMatch: o.rawMatch })),
    removedLegacy: removedLegacy.map(l => ({ id: l.id, axis: l.axis })),
    legacyOverrides: LEGACY_OVERRIDES.map(l => ({ id: l.id, axis: l.axis, type: l.type, threshold: l.threshold, rationale: l.rationale }))
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

  console.log(
    'check-hypermeta-jurisdiction: PASS (' +
    registered.length + ' legacy override(s) allowlisted, 0 new) -> metrics/hypermeta-jurisdiction.json'
  );
}

main();
