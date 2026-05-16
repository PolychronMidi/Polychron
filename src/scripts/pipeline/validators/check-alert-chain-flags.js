'use strict';
// Catches regression of "alert-chain-disabling" environment flags. Failure
// modes blocked here have a documented history of recurring silent-fail
// cascades, so this verifier locks the resolved state.
//
// Each entry encodes:
//   - file path (.env, settings.json, etc.)
//   - regex matching the disabling assignment
//   - human-readable history note for why this flag must stay this way
//
// Add new entries here when you discover a flag that, when flipped, makes
// the alert chain (LIFESAVER / AUTO-COMPLETENESS / EXHAUST / NEXUS)
// silently strip actionable content or skip emission.

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..', '..', '..');

const REGRESSIONS = [
  {
    file: '.env',
    badPattern: /^HME_DOMINANCE\s*=\s*1\s*$/m,
    requirePattern: /^HME_DOMINANCE\s*=\s*0\s*$/m,
    name: 'HME_DOMINANCE=1',
    history:
      'Historical: when HME_DOMINANCE=1, the deleted ' +
      'dominance_response_rewriter middleware translated Stop-hook deny ' +
      'content into "auto-X queued" placeholders, stripping actionable ' +
      'directives. File deleted as subversion attempt; flag must stay 0 ' +
      'so any re-introduced stripping rewriter cannot activate.',
  },
  {
    file: 'tools/HME/event_kernel/dispatcher.js',
    badPattern: /rewriter\.rewriteStopOutput\s*\(/,
    name: 'event-kernel-calls-rewriteStopOutput',
    history:
      'event_kernel/dispatcher.js must NOT invoke any rewriteStopOutput-style mangler ' +
      'on Stop result. Any call site here re-enables the dominance class.',
  },
];

function check() {
  const violations = [];
  for (const r of REGRESSIONS) {
    const fp = path.join(ROOT, r.file);
    if (!fs.existsSync(fp)) {
      violations.push(`MISSING FILE: ${r.file} (cannot verify ${r.name})`);
      continue;
    }
    const src = fs.readFileSync(fp, 'utf8');
    if (r.badPattern.test(src)) {
      violations.push(
        `REGRESSION (bad pattern matched) in ${r.file}: ${r.name}. History: ${r.history}`
      );
    } else if (r.requirePattern && !r.requirePattern.test(src)) {
      violations.push(
        `MISSING canonical pattern in ${r.file}: ${r.name}. History: ${r.history}`
      );
    }
  }
  return violations;
}

const violations = check();
if (violations.length > 0) {
  for (const v of violations) console.error('  ' + v);
  console.error(`\ncheck-alert-chain-flags: FAIL (${violations.length} violation${violations.length === 1 ? '' : 's'})`);
  process.exit(1);
}
console.log(`check-alert-chain-flags: PASS (${REGRESSIONS.length} regression check${REGRESSIONS.length === 1 ? '' : 's'} verified)`);
