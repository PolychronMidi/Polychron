'use strict';
/**
 * Shell-wrapper helper for transitional policies. Spawns a bash subprocess
 * that sources the named lifecycle stage script with the right helpers and
 * env, captures stdout/stderr, and parses for a block-decision JSON.
 *
 * Why this exists: not every legacy `stop/<stage>.sh` is worth porting to
 * pure JS in one pass. autocommit is hundreds of lines of git logic;
 * holograph and post_hooks are diagnostic side-effects with no decisions.
 * Wrapping them keeps the chain working while pure-JS conversions land
 * incrementally. The PROCESS BOUNDARY between the evaluator and bash means
 * an `exit 0` from a shell stage exits only the child — the evaluator
 * cannot be bypassed.
 */

const { spawn } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const HELPERS_DIR  = path.join(PROJECT_ROOT, 'tools/HME/hooks/helpers');
const STAGE_DIR    = path.join(PROJECT_ROOT, 'tools/HME/hooks/lifecycle/stop');
const DETECTORS_DIR = path.join(PROJECT_ROOT, 'tools/HME/scripts/detectors');

/**
 * Create a policy that delegates to a bash stage script.
 * `parseDecision`: optional override for stdout-parsing logic. Default
 * detects `{"decision":"block",...}` JSON anywhere in stdout.
 */
function shellPolicy(stageName, opts = {}) {
  const { timeoutMs = 30_000, parseDecision = defaultParseDecision } = opts;
  return {
    name: stageName,
    async run(ctx) {
      const result = await spawnStage(stageName, ctx.stdinJson, timeoutMs);
      const decisionFromStdout = parseDecision(result.stdout, ctx);
      if (decisionFromStdout) return decisionFromStdout;
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
  return new Promise((resolve) => {
    // PROJECT is the legacy alias for PROJECT_ROOT used by lifesaver.sh and
    // post_hooks.sh. Under the original sourced-chain bash dispatcher,
    // lifesaver.sh set PROJECT in its scope and post_hooks.sh inherited it.
    // Under subprocess isolation each stage runs in its own shell, so we
    // export the alias from the wrapper. Catches the broken cross-stage
    // dependency the audit-shell-undefined-vars verifier surfaced.
    // Set _HME_HOOK_NAME explicitly to the stage name BEFORE sourcing
    // _safety.sh -- _safety.sh's name resolution does
    // `_HME_HOOK_NAME="$(basename "${BASH_SOURCE[1]:-unknown}" .sh)"`,
    // and BASH_SOURCE[1] is unset inside a `bash -c` body (no parent
    // script). Without the explicit assign, every stage's EXIT-trap
    // latency entry recorded `hook=unknown`, which universal_pulse
    // bucketed and false-alarmed on. _safety.sh respects an existing
    // value because `_HME_HOOK_NAME=...` only fires once at top of
    // _safety.sh; we set it before sourcing so the assignment there
    // overwrites it -- this ALSO fixes the BASH_SOURCE fallback path.
    // Both work together: explicit name AND _safety.sh assignment land
    // on the same value (stage name).
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
    let child;
    try {
      child = spawn('bash', ['-c', wrapper], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PROJECT_ROOT },
      });
    } catch (err) {
      resolve({ stdout: '', stderr: `[shell_policy] spawn failed: ${err.message}`, exit_code: -1 });
      return;
    }
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
      resolve({ stdout, stderr: stderr + `\n[shell_policy] timeout: ${stageName}`, exit_code: -1 });
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n[shell_policy] error: ${err.message}`, exit_code: -1 });
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? 0 });
    });
    try {
      child.stdin.write(stdinJson || '');
      child.stdin.end();
    } catch (_e) { /* swallow — child error/close handler will resolve */ }
  });
}

module.exports = { shellPolicy, spawnStage };
