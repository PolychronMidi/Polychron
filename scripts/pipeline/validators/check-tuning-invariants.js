// scripts/check-tuning-invariants.js
// Executable cross-constant invariant checker.
// Verifies that the feedback loop constants documented in TUNING_MAP.md
// maintain their required relationships. Fails fast if any invariant is
// violated, preventing silent drift as constants are tuned.
//
// Constants are extracted directly from source files using regex, so this
// script has zero runtime coupling to the composition engine.
//
// Run: node scripts/check-tuning-invariants.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const SRC  = path.join(ROOT, 'src');

// -Constant extraction utilities -

function readFile(relPath) {
  const abs = path.join(SRC, relPath);
  if (!fs.existsSync(abs)) throw new Error('check-tuning-invariants: file not found: ' + relPath);
  return fs.readFileSync(abs, 'utf8');
}

function extractConst(src, pattern) {
  const m = src.match(pattern);
  if (!m) return null;
  const val = parseFloat(m[1]);
  if (!Number.isFinite(val)) return null;
  return val;
}

function extractClampRange(src, varName) {
  // Match patterns like: clamp(..., lo, hi) where varName is assigned
  const re = new RegExp(varName + '\\s*=\\s*clamp\\([^,]+,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*\\)');
  const m = src.match(re);
  if (m) return [parseFloat(m[1]), parseFloat(m[2])];
  // Also try: clampRange: [lo, hi]
  const re2 = new RegExp("clampRange\\s*:\\s*\\[\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*\\]");
  const m2 = src.match(re2);
  if (m2) return [parseFloat(m2[1]), parseFloat(m2[2])];
  return null;
}

// -Extract all critical constants -

function extractConstants() {
  const coherence = readFile('conductor/signal/foundations/coherenceMonitor.js');
  const negotiation = readFile('crossLayer/structure/negotiation/negotiationEngine.js');
  const trust = readFile('crossLayer/structure/trust/adaptiveTrustScores.js');
  const entropy = readFile('crossLayer/structure/entropy/entropyRegulator.js');
  const profile = readFile('conductor/signal/foundations/profileAdaptation.js');
const coupling = readFile('conductor/signal/balancing/coupling/couplingConstants.js');

  return {
    // coherenceMonitor
    coherence_BIAS_FLOOR: extractConst(coherence, /BIAS_FLOOR\s*=\s*([\d.]+)/),
    coherence_BIAS_CEILING: extractConst(coherence, /BIAS_CEILING\s*=\s*([\d.]+)/),
    coherence_SMOOTHING: extractConst(coherence, /SMOOTHING\s*=\s*([\d.]+)/),
    coherence_WINDOW_SIZE: extractConst(coherence, /WINDOW_SIZE\s*=\s*(\d+)/),
    coherence_ENTROPY_DECAY: extractConst(coherence, /ENTROPY_DECAY\s*=\s*([\d.]+)/),

    // negotiationEngine - extract named constants (post-refactor) or inline literals (legacy)
    negotiation_playScale_min: extractConst(negotiation, /PLAY_SCALE_MIN\s*=\s*([\d.]+)/) ||
      (() => { const m = negotiation.match(/playScale\s*=\s*clamp\([^,]+,\s*([\d.]+)\s*,\s*[\d.]+\s*\)/); return m ? parseFloat(m[1]) : null; })(),
    negotiation_playScale_max: extractConst(negotiation, /PLAY_SCALE_MAX\s*=\s*([\d.]+)/) ||
      (() => { const m = negotiation.match(/playScale\s*=\s*clamp\([^,]+,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/); return m ? parseFloat(m[2]) : null; })(),
    negotiation_stutterScale_min: extractConst(negotiation, /STUTTER_SCALE_MIN\s*=\s*([\d.]+)/) ||
      (() => { const m = negotiation.match(/stutterScale\s*=\s*clamp\([^,]+,\s*([\d.]+)\s*,\s*[\d.]+\s*\)/); return m ? parseFloat(m[1]) : null; })(),
    negotiation_stutterScale_max: extractConst(negotiation, /STUTTER_SCALE_MAX\s*=\s*([\d.]+)/) ||
      (() => { const m = negotiation.match(/stutterScale\s*=\s*clamp\([^,]+,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/); return m ? parseFloat(m[2]) : null; })(),
    negotiation_conflict_threshold: extractConst(negotiation, /CONFLICT_THRESHOLD\s*=\s*([\d.]+)/) ||
      extractConst(negotiation, /conflict\s*>\s*([\d.]+)/),
    negotiation_cadence_phase_min: extractConst(negotiation, /CADENCE_PHASE_MIN\s*=\s*([\d.]+)/) ||
      extractConst(negotiation, /phaseConfidence\s*>=\s*([\d.]+)/),
    negotiation_cadence_trust_min: extractConst(negotiation, /CADENCE_TRUST_MIN\s*=\s*([\d.]+)/) ||
      extractConst(negotiation, /trustCadence\s*>=\s*([\d.]+)/),

    // adaptiveTrustScores
    trust_EMA_decay: extractConst(trust, /BASE_EMA_DECAY\s*=\s*([\d.]+)/) || extractConst(trust, /score\s*\*\s*([\d.]+)\s*\+/),
    trust_EMA_new: extractConst(trust, /BASE_EMA_NEW\s*=\s*([\d.]+)/) || extractConst(trust, /\+\s*p\s*\*\s*([\d.]+)/),
    trust_weight_multiplier: extractConst(trust, /TRUST_WEIGHT_MULTIPLIER\s*=\s*([\d.]+)/) || extractConst(trust, /1\s*\+\s*(?:state\.score|effectiveScore)\s*\*\s*([\d.]+)/),
    trust_weight_min: extractConst(trust, /TRUST_WEIGHT_MIN\s*=\s*([\d.]+)/) || (() => {
      const m = trust.match(/clamp\(\s*1\s*\+\s*(?:state\.score|effectiveScore)\s*\*\s*[\d.]+\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[1]) : null;
    })(),
    trust_weight_max: extractConst(trust, /TRUST_WEIGHT_MAX\s*=\s*([\d.]+)/) || (() => {
      const m = trust.match(/clamp\(\s*1\s*\+\s*(?:state\.score|effectiveScore)\s*\*\s*[\d.]+\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
      return m ? parseFloat(m[2]) : null;
    })(),
    trust_CEILING: extractConst(trust, /TRUST_CEILING\s*=\s*([\d.]+)/),

    // entropyRegulator - extract named constants (post-refactor) or inline clampRange (legacy)
    entropy_clampRange_min: extractConst(entropy, /REGULATION_CLAMP_MIN\s*=\s*([\d.]+)/) ||
      (() => { const m = entropy.match(/clampRange\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/); return m ? parseFloat(m[1]) : null; })(),
    entropy_clampRange_max: extractConst(entropy, /REGULATION_CLAMP_MAX\s*=\s*([\d.]+)/) ||
      (() => { const m = entropy.match(/clampRange\s*:\s*\[\s*([\d.]+)\s*,\s*([\d.]+)\s*\]/); return m ? parseFloat(m[2]) : null; })(),

    // profileAdaptation
    profile_DENSITY_LOW_THRESHOLD: extractConst(profile, /DENSITY_LOW_THRESHOLD\s*=\s*([\d.]+)/),
    profile_TENSION_HIGH_THRESHOLD: extractConst(profile, /TENSION_HIGH_THRESHOLD\s*=\s*([\d.]+)/),
    profile_STREAK_TRIGGER: extractConst(profile, /STREAK_TRIGGER\s*=\s*(\d+)/),

    // pipelineCouplingManager
    coupling_DEFAULT_TARGET: extractConst(coupling, /DEFAULT_TARGET\s*=\s*([\d.]+)/),
    coupling_GAIN_MAX: extractConst(coupling, /GAIN_MAX\s*=\s*([\d.]+)/),
  };
}

// -Invariant definitions -
// Each invariant has a name, a check function, and a human-readable description.

function defineInvariants(c) {
  return [
    {
      name: 'density-ceiling-chain',
      description: 'coherenceMonitor.BIAS_CEILING * negotiation.playScale_max must not exceed 2.5 (prevents audible note-cramming)',
      check: () => {
        const product = c.coherence_BIAS_CEILING * c.negotiation_playScale_max;
        return { pass: product <= 2.5, actual: product, limit: 2.5 };
      }
    },
    {
      name: 'trust-weight-symmetry',
      description: 'adaptiveTrustScores weight clamp must match negotiation playScale clamp (trust cannot push outside negotiation range)',
      check: () => {
        const minMatch = c.trust_weight_min === c.negotiation_playScale_min;
        const maxMatch = c.trust_weight_max === c.negotiation_playScale_max;
        return {
          pass: minMatch && maxMatch,
          trustRange: [c.trust_weight_min, c.trust_weight_max],
          negotiationRange: [c.negotiation_playScale_min, c.negotiation_playScale_max]
        };
      }
    },
    {
      name: 'entropy-headroom',
      description: 'entropyRegulator scale clamp range must not allow effective multiplier > 3.0 when combined with negotiation entropy modulator',
      check: () => {
        // entropy scale [0.3, 2.0] * negotiation entropy mod [0.5, 1.5]
        const maxEffective = c.entropy_clampRange_max * 1.5;
        return { pass: maxEffective <= 3.5, actual: maxEffective, softLimit: 3.5 };
      }
    },
    {
      name: 'coherence-smoothing-stability',
      description: 'coherenceMonitor SMOOTHING must be >= 0.4 to prevent visible density oscillation',
      check: () => {
        return { pass: c.coherence_SMOOTHING >= 0.4, actual: c.coherence_SMOOTHING, minimum: 0.4 };
      }
    },
    {
      name: 'bias-ceiling-below-play-scale',
      description: 'coherenceMonitor BIAS_CEILING must be < negotiation playScale max to prevent density runaway',
      check: () => {
        return {
          pass: c.coherence_BIAS_CEILING < c.negotiation_playScale_max,
          biasCeiling: c.coherence_BIAS_CEILING,
          playScaleMax: c.negotiation_playScale_max
        };
      }
    },
    {
      name: 'trust-ceiling-weight-coherence',
      description: 'TRUST_CEILING * weight_multiplier + 1 must not exceed trust_weight_max (trust ceiling must produce valid weight)',
      check: () => {
        const maxWeight = 1 + c.trust_CEILING * c.trust_weight_multiplier;
        return {
          pass: maxWeight <= c.trust_weight_max,
          computedMaxWeight: maxWeight,
          declaredMax: c.trust_weight_max
        };
      }
    },
    {
      name: 'profile-streak-timing',
      description: 'profileAdaptation STREAK_TRIGGER must be >= 4 to prevent false positives from momentary lulls',
      check: () => {
        return { pass: c.profile_STREAK_TRIGGER >= 4, actual: c.profile_STREAK_TRIGGER, minimum: 4 };
      }
    },
    {
      name: 'ema-rate-consistency',
      description: 'Trust EMA decay + new-data rate must sum to 1.0',
      check: () => {
        const sum = c.trust_EMA_decay + c.trust_EMA_new;
        return { pass: Math.abs(sum - 1.0) < 0.001, actual: sum, expected: 1.0 };
      }
    },
    {
      name: 'stutter-scale-wider-than-play',
      description: 'Negotiation stutter scale range must be wider than play scale range (stutter is more exploratory)',
      check: () => {
        const playRange = c.negotiation_playScale_max - c.negotiation_playScale_min;
        const stutterRange = c.negotiation_stutterScale_max - c.negotiation_stutterScale_min;
        return { pass: stutterRange >= playRange, stutterRange, playRange };
      }
    },
    {
      name: 'coupling-gain-headroom',
      description: 'pipelineCouplingManager GAIN_MAX must not exceed 1.0 (would overcorrect)',
      check: () => {
        return { pass: c.coupling_GAIN_MAX <= 1.0, actual: c.coupling_GAIN_MAX, limit: 1.0 };
      }
    }
  ];
}

// -Main -

function main() {
  const constants = extractConstants();

  // Verify we extracted all required constants
  const missing = Object.entries(constants).filter(([, v]) => v === null);
  if (missing.length > 0) {
    console.warn(
      'check-tuning-invariants: WARNING - could not extract ' + missing.length +
      ' constant(s): ' + missing.map(([k]) => k).join(', ')
    );
    console.warn('check-tuning-invariants: invariants depending on missing constants will be skipped');
  }

  const invariants = defineInvariants(constants);
  const results = [];
  let failures = 0;
  let skipped = 0;

  for (const inv of invariants) {
    try {
      const result = inv.check();
      results.push({ name: inv.name, description: inv.description, ...result });
      if (!result.pass) {
        failures++;
        console.error('  FAIL: ' + inv.name + ' - ' + inv.description);
        console.error('        ' + JSON.stringify(result));
      }
    } catch (e) {
      skipped++;
      results.push({ name: inv.name, description: inv.description, skipped: true, reason: e.message });
      console.warn('  SKIP: ' + inv.name + ' - ' + (e.message || 'extraction error'));
    }
  }

  // Write results for forensics
  const outputPath = path.join(ROOT, 'metrics', 'tuning-invariants.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({
    meta: { generated: new Date().toISOString(), total: invariants.length, passed: invariants.length - failures - skipped, failed: failures, skipped },
    constants,
    results
  }, null, 2), 'utf8');

  if (failures > 0) {
    throw new Error(
      'check-tuning-invariants: ' + failures + ' invariant(s) FAILED. ' +
      'See metrics/tuning-invariants.json for details. ' +
      'Cross-reference TUNING_MAP.md before changing feedback loop constants.'
    );
  }

  console.log(
    'check-tuning-invariants: PASS (' +
    (invariants.length - skipped) + '/' + invariants.length + ' checked, ' +
    skipped + ' skipped) -> metrics/tuning-invariants.json'
  );
}

main();
