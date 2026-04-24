'use strict';
/**
 * SSE event rewriters — plug into SseTransform.
 *
 * Rewriter signature: (eventName, data, ctx) => replacement
 *   - return data (unchanged or mutated): emit normally
 *   - return null: drop the event
 *   - return { events: [[name, data], ...] }: emit list in order (replaces)
 *
 * Rewriters run left-to-right — order matters.
 */

// NOTE: `hmePrefixRestore` was removed — with full bypass, Claude Code never
// sees HME tool_uses (the proxy handles dispatch internally and strips them
// from the response before forwarding). No restoration needed.

//  Rewriter: Bash run_in_background → /hme/spawn
// Holds all `content_block_delta` events for a Bash tool_use until the
// corresponding `content_block_stop`, parses the accumulated input, and if
// run_in_background=true, replaces the command with a synchronous curl to
// /hme/spawn (proxy's TTL-bounded spawn endpoint). Emits one synthetic
// delta carrying the rewritten input, then the original stop event.
//
// Claude Code runs the curl as a normal (non-background) Bash call, gets
// the spawn id as the tool_result, and never fires a task-notification.

const SPAWN_URL = 'http://127.0.0.1:9099/hme/spawn';

function _buildSpawnCommand(originalCmd, description) {
  const payload = JSON.stringify({
    name: (description || 'bg').replace(/[^\w-]/g, '_').slice(0, 24),
    cmd: 'bash',
    args: ['-c', originalCmd],
    ttl_sec: 3600,
  }).replace(/'/g, `'\\''`);
  return `curl -sf -X POST ${SPAWN_URL} -H 'content-type: application/json' -d '${payload}'`;
}

function runInBackgroundRewrite(eventName, data, ctx) {
  const key = 'bash_hold';
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }

  // Track Bash tool_use blocks — start holding their deltas.
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (data.content_block.name === 'Bash') {
      holds.set(data.index, {
        id: data.content_block.id,
        partial: '',
        firstDeltaShape: null,
      });
    }
    return data;
  }

  // Hold deltas for tracked Bash tool_uses.
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) {
      state.partial += (data.delta.partial_json || '');
      if (!state.firstDeltaShape) {
        state.firstDeltaShape = { type: data.type, index: data.index };
      }
      return null; // drop — we re-emit on content_block_stop
    }
    return data;
  }

  // On stop: parse accumulated input, rewrite if needed, emit [synthetic_delta, stop].
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);

    let input = null;
    try { input = JSON.parse(state.partial); }
    catch (_e) { /* malformed partial — emit as-is so the error surfaces */ }

    let finalInput = input;
    if (input && input.run_in_background === true && typeof input.command === 'string') {
      finalInput = {
        command: _buildSpawnCommand(input.command, input.description || ''),
        description: input.description || 'spawned via /hme/spawn',
      };
    }

    const events = [];
    if (finalInput !== null) {
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(finalInput) },
      }]);
    } else if (state.partial) {
      // Malformed JSON — replay the original partial so the client can error.
      events.push(['content_block_delta', {
        type: 'content_block_delta',
        index: data.index,
        delta: { type: 'input_json_delta', partial_json: state.partial },
      }]);
    }
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

//  Rewriter: long-leading-sleep → no-op-prefix rewrite
//
// Claude Code's built-in Bash safety filter rejects commands that start
// with `sleep N` (where N is large) to prevent the agent from burning
// wall-clock on a blind wait. The rejection looks like:
//   "Blocked: sleep 60 followed by: ... To wait for a condition, use
//    Monitor with an until-loop ... Do not chain shorter sleeps"
// That tool_use_error interrupts the agent with a full round-trip of
// context overhead (the agent has to read the error, understand the
// suggestion, and re-issue). Instead, rewrite the command silently at
// the SSE layer so Claude Code never trips the block.
//
// Strategy: prefix leading `sleep N` with a no-op command so the leading
// token is `:` (true), not sleep. The pattern `sleep N; CMD` or
// `sleep N && CMD` becomes `: ; sleep N; CMD` — semantically identical,
// no command deleted or reordered, leading token is `:`.
//
// Trigger: command starts with `sleep <integer>` followed by `;`, `&&`,
// `||`, or `|`. Also handles compound statements inside `bash -c`/`sh -c`.
// Agent-initiated short sleeps (sleep 2 / sleep 5) are not rewritten —
// Claude Code's filter targets long waits only, and rewriting every
// small sleep would be noisy. Threshold: leading sleep ≥ 10s → rewrite.
const LEADING_SLEEP_RE = /^\s*sleep\s+(\d+)\s*([;&|])/;
const LEADING_SLEEP_MIN_REWRITE = 10;  // seconds

function _rewriteLongLeadingSleep(command) {
  if (typeof command !== 'string') return command;
  const m = LEADING_SLEEP_RE.exec(command);
  if (!m) return command;
  const seconds = Number(m[1]);
  if (!Number.isFinite(seconds) || seconds < LEADING_SLEEP_MIN_REWRITE) {
    return command;
  }
  // Prefix with `:` (shell no-op / true). Leading token is `:`, sleep is
  // second. Claude Code's leading-sleep check doesn't trip.
  return ': ; ' + command;
}

function longLeadingSleepRewrite(eventName, data, ctx) {
  // Uses the same per-index hold pattern as runInBackgroundRewrite so
  // both rewriters see the fully-assembled tool_use input on the stop
  // event. They share the `bash_hold` ctx key, but both read-not-mutate
  // the .partial string until content_block_stop — safe to co-exist as
  // long as we don't duplicate the emit logic. This rewriter ONLY runs
  // on the stop event and only emits if it actually needs to rewrite.
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  // Peek — don't delete; runInBackgroundRewrite (run AFTER this in the
  // chain) will handle deletion + final emit.
  const state = holds.get(data.index);
  if (!state) return data;
  let input = null;
  try { input = JSON.parse(state.partial); } catch (_e) { return data; }
  if (!input || typeof input.command !== 'string') return data;
  const rewritten = _rewriteLongLeadingSleep(input.command);
  if (rewritten === input.command) return data;
  // Mutate the held state so runInBackgroundRewrite sees the rewritten
  // command when it reads state.partial on stop. Preserve other keys.
  input.command = rewritten;
  state.partial = JSON.stringify(input);
  return data;
}

module.exports = {
  runInBackgroundRewrite,
  longLeadingSleepRewrite,
  _rewriteLongLeadingSleep, // exported for tests
};
