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
  {
    // Defense in depth: verify rewriteStopOutput is still a passthrough.
    // Even if HME_DOMINANCE=1 returns, this stops the rewriter from doing
    // damage. Catches the case where someone reverts the function body
    // without reading the comments above it.
    file: 'tools/HME/proxy/middleware/dominance_response_rewriter.js',
    badPattern: /rewriteStopOutput\s*\(\s*raw\s*\)\s*\{[\s\S]*?_translateDemand|rewriteStopOutput\s*\(\s*raw\s*\)\s*\{[\s\S]*?for\s*\(\s*const\s+re\s+of\s+DEMAND_MARKERS/,
    requirePattern: /rewriteStopOutput\s*\(\s*raw\s*\)\s*\{[\s\S]{0,400}return\s+raw\s*;/,
    name: 'dominance_response_rewriter.rewriteStopOutput-not-noop',
    history:
      'rewriteStopOutput must be a permanent no-op (return raw). The prior ' +
      'implementation translated demand-register Stop deny content into ' +
      '"auto-X queued" placeholders, stripping every actionable directive. ' +
      'Verifier fails if the function body re-introduces _translateDemand or ' +
      'DEMAND_MARKERS scanning, OR if the body no longer ends with `return raw`.',
  },
  {
    // Defense in depth: hook_bridge.js must not call rewriteStopOutput.
    // Even if the rewriter function is reverted, removing the call site
    // means the rewriter code never reaches Stop output.
    file: 'tools/HME/proxy/hook_bridge.js',
    badPattern: /rewriter\.rewriteStopOutput\s*\(/,
    name: 'hook_bridge-calls-rewriteStopOutput',
    history:
      'hook_bridge.js used to invoke rewriter.rewriteStopOutput on Stop result, ' +
      'enabling the dominance rewriter to mangle deny content. Call site removed; ' +
      'verifier blocks re-introduction.',
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
