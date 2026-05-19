'use strict';
/**
 * Portable shell-stage adapter for Stop policies. It writes the event payload
 * through event-kernel filesystem IPC, sources the named stage script with the
 * right helpers/env, captures stdout/stderr, and parses block-decision JSON.
 *
 * Why this exists: not every legacy `stop/<stage>.sh` is worth porting to
 * pure JS in one pass. autocommit is hundreds of lines of git logic;
 * holograph and post_hooks are diagnostic side-effects with no decisions.
 * Keeping them behind this adapter preserves behavior while pure-JS
 * conversions land incrementally. The PROCESS BOUNDARY between evaluator and bash means
 * an `exit 0` from a shell stage exits only the child -- the evaluator
 * cannot be bypassed.
 */

const path = require('path');
const { PROJECT_ROOT } = require('../shared');
const { spawnFileInput } = require('../../event_kernel/fs_ipc');

const HELPERS_DIR  = path.join(PROJECT_ROOT, 'tools/HME/hooks/helpers');
const STAGE_DIR    = path.join(PROJECT_ROOT, 'tools/HME/hooks/lifecycle/stop');
const DETECTORS_DIR = path.join(PROJECT_ROOT, 'tools/HME/scripts/detectors');

/**
 * Create a policy that delegates to a bash stage script.
 * `parseDecision`: optional override for stdout-parsing logic. Default
 * detects `{"decision":"block",...}` JSON anywhere in stdout.
 */
function shellPolicy(stageName, opts = {}) {
  const { timeoutMs = 30_000, parseDecision = defaultParseDecision, failClosed = false } = opts;
  return {
    name: stageName,
    async run(ctx) {
      const result = await spawnStage(stageName, ctx.stdinJson, timeoutMs);
      const decisionFromStdout = parseDecision(result.stdout, ctx);
      if (decisionFromStdout) return decisionFromStdout;
      if (failClosed && (result.exit_code !== 0 || result.error || result.signal)) {
        const detail = (result.stderr || (result.error && result.error.message) || result.signal || `exit ${result.exit_code}`).trim();
        return ctx.deny(`STOP-CHAIN INTEGRITY FAILURE: shell policy ${stageName} failed closed (${detail.slice(0, 800)}). Fix the policy before stopping.`);
      }
      return ctx.allow();
    },
  };
}

function defaultParseDecision(stdout, ctx) {
  if (!stdout) return null;
  if (!/"decision"\s*:\s*"block"/.test(stdout)) return null;
  try {
    const parsed = JSON.parse(stdout.trim());
    if (parsed && parsed.decision === 'block') {
      return ctx.deny(parsed.reason || `(stage emitted block with no reason)`);
    }
  } catch (_e) {
    // silent-ok: optional fallback path.
    // The stage emitted block-shaped JSON we couldn't parse cleanly. Try
    // greedy-extract the first JSON object that contains "decision":"block".
    const m = stdout.match(/\{[^{}]*"decision"\s*:\s*"block"[^{}]*\}/);
    if (m) {
      try {
        const parsed = JSON.parse(m[0]);
        if (parsed && parsed.decision === 'block') {
          return ctx.deny(parsed.reason || `(stage emitted block with no reason)`);
        }
      } catch (_e2) { /* fall through */ }
    }
    return ctx.deny(`(stage ${arguments[0]} emitted malformed decision JSON)`);
  }
  return null;
}

function spawnStage(stageName, stdinJson, timeoutMs) {
  // PROJECT alias for PROJECT_ROOT (legacy; lifesaver.sh + post_hooks.sh
  const wrapper = `
set +u +e
PROJECT="${PROJECT_ROOT}"
_HME_HELPERS_DIR="${HELPERS_DIR}"
_STOP_DIR="${path.dirname(STAGE_DIR)}"
_DETECTORS_DIR="${DETECTORS_DIR}"
_HME_STAGE_NAME="stop_chain:${stageName}"
export PROJECT _HME_HELPERS_DIR _STOP_DIR _DETECTORS_DIR _HME_STAGE_NAME
source "${HELPERS_DIR}/_safety.sh" 2>/dev/null
# _safety.sh's BASH_SOURCE[1] resolution sets _HME_HOOK_NAME to "unknown"
# inside bash -c. Override AFTER sourcing so the latency trap reports
# the actual stage name (post_hooks / holograph / evolver / etc).
_HME_HOOK_NAME="$_HME_STAGE_NAME"
INPUT=$(cat)
source "${path.join(STAGE_DIR, stageName + '.sh')}"
`;

  return spawnFileInput('bash', ['-c', wrapper], {
    input: stdinJson || '',
    timeoutMs,
    label: `stop-${stageName}`,
    env: { PROJECT_ROOT },
  });
}

module.exports = { shellPolicy, spawnStage };
