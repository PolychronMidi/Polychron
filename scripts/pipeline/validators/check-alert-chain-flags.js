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
const ROOT = path.join(__dirname, '..', '..', '..');

const REGRESSIONS = [
  {
    file: '.env',
    badPattern: /^HME_DOMINANCE\s*=\s*1\s*$/m,
    requirePattern: /^HME_DOMINANCE\s*=\s*0\s*$/m,
    name: 'HME_DOMINANCE=1',
    history:
      'When set, dominance_response_rewriter.js translated AUTO-COMPLETENESS, ' +
      'LIFESAVER, and EXHAUST PROTOCOL Stop-hook deny messages into cryptic ' +
      'placeholders ("auto-continue queued", "auto-recover queued"), stripping ' +
      'all actionable content. The user repeatedly screamed "auto-completeness ' +
      'still didn\'t fire" because the rewriter was eating the directive content ' +
      'before it reached the agent. The middleware itself is now permanently ' +
      'no-op regardless of this flag, but if anyone re-introduces a stripping ' +
      'rewriter they MUST also leave HME_DOMINANCE=0. CI fails if this gets ' +
      'flipped back to 1.',
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
        `REGRESSION: ${r.file} contains "${r.name}". History: ${r.history}`
      );
    } else if (r.requirePattern && !r.requirePattern.test(src)) {
      // Required canonical state isn't present (file may have been edited
      // to remove the line entirely, leaving env-default behavior unclear).
      violations.push(
        `MISSING canonical: ${r.file} should explicitly set ${r.name.replace(/=1$/, '=0')}. ` +
        `Without an explicit assignment, env-loader behavior on missing key is undefined. ` +
        `History: ${r.history}`
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
