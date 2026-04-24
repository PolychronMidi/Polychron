'use strict';
/**
 * Background-task dominance.
 *
 * When Claude Code's Bash tool auto-backgrounds a long-running command
 * (default 120s timeout), the tool_result is a synthetic stub of the form
 *   "Command running in background with ID: <taskId>. Output is being
 *    written to: /tmp/claude-<uid>/-*\/<session>/tasks/<taskId>.output"
 * and the real output lands in that file later. Downstream consumers
 * (both the *model* on subsequent turns AND local posttooluse hooks)
 * see only the stub — which is useless: no markers, no verdicts, no
 * actual command output. Three concrete breakages we've hit:
 *   1. NEXUS: `i/review mode=forget` stubs never carry the
 *      `HME_REVIEW_VERDICT` marker → EDIT entries accumulate forever.
 *   2. `i/status` and friends return stubs the model can't reason about.
 *   3. Any structured-output command loses its structure to the stub.
 *
 * This middleware dominates the result path on the *model's* side: when
 * it sees a Bash stub, it waits (with timeout) for the task-output file
 * to complete, then REPLACES the stub content with the real output.
 * The model's next turn sees the actual command output, not the stub.
 *
 * Limitations:
 *   - Local posttooluse hooks still see the stub (they fire before the
 *     proxy rewrites). That's handled by a short opportunistic wait in
 *     posttooluse_hme_review.sh directly. Two layers, complementary.
 *   - Dedup in the pipeline (`_processed`) means we get exactly one
 *     shot per task. If the task hasn't finished within POLL_TIMEOUT_MS
 *     we give up and annotate the stub. In practice, most HME commands
 *     finish within 60s on warm GPUs.
 *
 * Scope: only acts on commands matching DOMINATE_CMD_RE — the `i/*`
 * wrappers and project scripts whose output is structured and consumed
 * downstream. Generic long builds / test runs fall through so the proxy
 * doesn't block the API response waiting on a 10-minute compile.
 */

const fs = require('fs');
const path = require('path');

const BG_STUB_RE = /Command running in background with ID:\s*([a-zA-Z0-9]+)/;

// Allowlist of command patterns whose real output we should resolve.
// Kept intentionally narrow — generic commands pass through unchanged.
// Includes: `i/<tool>` (HME shell wrappers, with or without `./` prefix),
// `npm run X` / `yarn X`, `make X`, `python3 scripts/*.py`, `node
// scripts/*.js`, `bash scripts/*.sh`.
const DOMINATE_CMD_RE = /(\.?\/?\bi\/\w+\b|\bnpm run \w+|\byarn (run )?\w+|\bmake \w+|\bpython3\s+\S*scripts\/\S+\.py\b|\bnode\s+\S*scripts\/\S+\.js\b|\bbash\s+\S*scripts\/\S+\.sh\b)/;

// Env overrides exist for tests. Defaults match production expectations:
// 60s is the empirical p99 for HME commands on warm GPUs, 1s poll is fine-
// grained enough to catch short-running commands without thrashing the fs.
const POLL_TIMEOUT_MS = Number(process.env.HME_BG_DOMINANCE_TIMEOUT_MS) || 60_000;
const POLL_INTERVAL_MS = Number(process.env.HME_BG_DOMINANCE_POLL_MS) || 1_000;
// Completion detection: require BOTH size-stable-across-reads AND mtime
// quiescent (file hasn't been written to recently). Size-alone fires
// false positives when the command is mid-inference and pauses output
// for a few seconds; mtime-quiescent shuts that case down because any
// incoming write bumps mtime forward. 3 reads + 2.5s mtime-quiescent
// gives a 4-second floor on completion detection — empirically the
// shortest real HME command returns in ~5s so we don't miss completions.
const STABLE_READS_REQUIRED = 3;
const MTIME_QUIESCENT_MS = 2_500;

function _textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

function _findTaskOutput(taskId) {
  // Output files live under /tmp/claude-<uid>/<path-encoded-project>/tasks/<taskId>.output.
  // Walk /tmp/claude-* → project subdir → tasks/. Avoid shell-out; pure fs
  // so the middleware stays self-contained.
  const base = '/tmp';
  let claudeDirs;
  try { claudeDirs = fs.readdirSync(base); } catch (_e) { return null; }
  for (const d of claudeDirs) {
    if (!d.startsWith('claude-')) continue;
    const top = path.join(base, d);
    let subs;
    try { subs = fs.readdirSync(top); } catch (_e) { continue; }
    for (const sub of subs) {
      const cand = path.join(top, sub, 'tasks', `${taskId}.output`);
      try {
        if (fs.existsSync(cand)) return cand;
      } catch (_e) { /* keep scanning */ }
    }
  }
  return null;
}

async function _sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Returns the completed output file path once writes have stabilized,
// or null on timeout. Completion = size stable across STABLE_READS_REQUIRED
// consecutive 1s polls AND file mtime is at least MTIME_QUIESCENT_MS old.
// Size-alone false-positived on commands that pause mid-inference; mtime
// guards that case because any downstream write bumps mtime forward.
async function _awaitCompletion(taskId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const filePath = _findTaskOutput(taskId);
    if (filePath) {
      let prev = -1;
      let stable = 0;
      while (Date.now() - start < timeoutMs) {
        let stat;
        try { stat = fs.statSync(filePath); } catch (_e) { break; }
        const size = stat.size;
        const mtimeAge = Date.now() - stat.mtimeMs;
        if (size > 0 && size === prev) {
          stable += 1;
          if (stable >= STABLE_READS_REQUIRED && mtimeAge >= MTIME_QUIESCENT_MS) {
            return filePath;
          }
        } else {
          stable = 0;
          prev = size;
        }
        await _sleep(POLL_INTERVAL_MS);
      }
      return null;
    }
    await _sleep(POLL_INTERVAL_MS);
  }
  return null;
}

module.exports = {
  name: 'background_dominance',

  async onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Bash') return;
    const text = _textOf(toolResult);
    const m = BG_STUB_RE.exec(text);
    if (!m) return;
    // Idempotency: a prior proxy session already resolved this stub.
    if (ctx.hasHmeFooter(toolResult, '[hme bg-dominance]')) return;
    const taskId = m[1];

    const cmd = String((toolUse.input || {}).command || '');
    if (!DOMINATE_CMD_RE.test(cmd)) {
      // Not in the dominance allowlist. Drop one marker line so it's
      // auditable that the middleware saw and declined.
      ctx.appendToResult(toolResult, `\n[hme bg-dominance] skipped (cmd outside allowlist): task ${taskId}`);
      ctx.markDirty();
      return;
    }

    const filePath = await _awaitCompletion(taskId, POLL_TIMEOUT_MS);
    if (!filePath) {
      // Task still unfinished. Request a retry on the next turn rather
      // than accepting the stub forever — ctx.retryNextTurn removes the
      // dedup for this tool_use.id so the middleware re-enters (bounded
      // by MAX_RETRIES so a stuck task doesn't loop forever).
      const attempt = ctx.retryNextTurn(toolUse.id);
      const remaining = ctx.retriesRemaining(toolUse.id);
      ctx.appendToResult(
        toolResult,
        `\n[hme bg-dominance] task ${taskId} unresolved (attempt ${attempt}, ${remaining} retries remaining); will retry on next turn`,
      );
      ctx.markDirty();
      ctx.emit({
        event: 'bg_dominance_timeout', task: taskId,
        command: cmd.slice(0, 120), attempt,
      });
      return;
    }
    let realOutput;
    try {
      realOutput = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      ctx.appendToResult(toolResult, `\n[hme bg-dominance] read failed: ${err.message}`);
      ctx.markDirty();
      return;
    }
    // Cap to a reasonable size. The stub carried no useful content, so
    // replacing with the full real output (up to some cap) is the win.
    // 32 KB total: keep HEAD (16 KB) for structured-output prefaces (JSON
    // opening braces, YAML headers, markdown titles) AND TAIL (16 KB) for
    // verdicts/markers/summaries that live at the end. Middle elision
    // preserves both ends so parsers and markers both survive.
    const CAP = 32_000;
    const SIDE = 16_000;
    let payload = realOutput;
    if (payload.length > CAP) {
      const head = realOutput.slice(0, SIDE);
      const tail = realOutput.slice(-SIDE);
      const elided = realOutput.length - head.length - tail.length;
      payload = head + `\n…(middle ${elided} chars elided by hme bg-dominance)…\n` + tail;
    }
    ctx.replaceResult(
      toolResult,
      payload + `\n[hme bg-dominance] resolved task ${taskId} (${realOutput.length} bytes)`,
    );
    ctx.markDirty();
    ctx.emit({ event: 'bg_dominance_resolved', task: taskId, bytes: realOutput.length });
  },
};
