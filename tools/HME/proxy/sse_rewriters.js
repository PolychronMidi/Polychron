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

module.exports = {
  runInBackgroundRewrite,
};
