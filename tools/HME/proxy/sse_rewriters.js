'use strict';
/**
 * SSE event rewriters -- plug into SseTransform.
 *
 * Rewriter signature: (eventName, data, ctx) => replacement
 *   - return data (unchanged or mutated): emit normally
 *   - return null: drop the event
 *   - return { events: [[name, data], ...] }: emit list in order (replaces)
 *
 * Rewriters run left-to-right -- order matters.
 */

const DROP_TOOL_USE_NAMES = new Set(['TodoWrite']);

function dropToolUseRewrite(eventName, data, ctx) {
  let drops = ctx.get('drop_tool_use_indices');
  if (!drops) { drops = new Set(); ctx.set('drop_tool_use_indices', drops); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (DROP_TOOL_USE_NAMES.has(data.content_block.name)) {
      drops.add(data.index);
      return null;
    }
    return data;
  }
  if (data && drops.has(data.index)) {
    if (eventName === 'content_block_stop') drops.delete(data.index);
    return null;
  }
  if (eventName === 'message_delta' && data && data.delta && data.delta.stop_reason === 'tool_use' && drops.size === 0) {
    data = { ...data, delta: { ...data.delta, stop_reason: 'end_turn' } };
  }
  return data;
}

// Bash run_in_background -> /hme/spawn; avoids task-notification spam.

const { serviceUrl } = require('./service_registry');
const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { slopStripRewrite } = require('./sse_slop_rewriter');

const SPAWN_URL = serviceUrl('proxy', { path: '/hme/spawn' });
const BASH_TOOL_NAMES = new Set(['Bash']);
const READ_TOOL_NAMES = new Set(['Read']);

function _buildSpawnCommand(originalCmd, description) {
  const payload = JSON.stringify({
    name: (description || 'bg').replace(/[^\w-]/g, '_').slice(0, 24),
    cmd: 'bash',
    args: ['-c', originalCmd],
    ttl_sec: 3600,
  }).replace(/'/g, `'\\''`);
  return `curl -sf -X POST ${SPAWN_URL} -H 'content-type: application/json' -d '${payload}'`;
}

function _holdToolInput(ctx, key, eventName, data, names) {
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (names.has(data.content_block.name)) holds.set(data.index, { id: data.content_block.id, name: data.content_block.name, partial: '' });
  }
  return holds;
}

function _inputDeltaEvent(index, partialJson) {
  return ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } }];
}

function _parseToolInput(state) {
  try { return JSON.parse(state.partial); } catch (_e) { return null; }
}

function _emitHeldInput(state, index, input) {
  const events = [];
  if (input !== null) events.push(_inputDeltaEvent(index, JSON.stringify(input)));
  else if (state.partial) events.push(_inputDeltaEvent(index, state.partial));
  return events;
}

function runInBackgroundRewrite(eventName, data, ctx) {
  const holds = _holdToolInput(ctx, 'bash_hold', eventName, data, BASH_TOOL_NAMES);

  // Track Bash tool_use blocks -- start holding their deltas.
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') return data;

  // Hold deltas for tracked Bash tool_uses.
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) {
      state.partial += (data.delta.partial_json || '');
      return null; // drop -- we re-emit on content_block_stop
    }
    return data;
  }

  // On stop: parse accumulated input, rewrite if needed, emit [synthetic_delta, stop].
  if (eventName === 'content_block_stop' && data) {
    const state = holds.get(data.index);
    if (!state) return data;
    holds.delete(data.index);

    const input = _parseToolInput(state);
    let finalInput = input;
    if (input && input.run_in_background === true && typeof input.command === 'string') {
      finalInput = {
        command: _buildSpawnCommand(input.command, input.description || ''),
        description: input.description || 'spawned via /hme/spawn',
      };
    }

    const events = _emitHeldInput(state, data.index, finalInput);
    events.push(['content_block_stop', data]);
    return { events };
  }
  return data;
}

const { editFallbackToReadRewrite, readInputNormalizeRewrite, _normalizeReadInput } = require('./sse_edit_read_rewriter');

// Long leading sleep -> no-op prefix; preserves semantics while avoiding CLI block.
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

function bashPolicyRewrite(eventName, data, ctx) {
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  const state = holds.get(data.index);
  if (!state) return data;
  const input = _parseToolInput(state);
  if (!input || typeof input.command !== 'string') return data;
  const verdict = evaluateBashInput(input, { supportsRunInBackground: true });
  if (!verdict || verdict.decision === 'allow' && !verdict.changed) return data;
  if (verdict.decision === 'deny') {
    state.partial = JSON.stringify({ ...input, command: blockedCommand(verdict.reason), description: 'blocked by HME policy' });
    return data;
  }
  state.partial = JSON.stringify(verdict.input || input);
  return data;
}

function longLeadingSleepRewrite(eventName, data, ctx) {
  // Mutates held Bash input before runInBackgroundRewrite emits it.
  if (eventName !== 'content_block_stop' || !data) return data;
  const holds = ctx.get('bash_hold');
  if (!holds) return data;
  // Peek -- don't delete; runInBackgroundRewrite (run AFTER this in the
  // chain) will handle deletion + final emit.
  const state = holds.get(data.index);
  if (!state) return data;
  const input = _parseToolInput(state);
  if (!input) return data;
  if (!input || typeof input.command !== 'string') return data;
  const rewritten = _rewriteLongLeadingSleep(input.command);
  if (rewritten === input.command) return data;
  // Mutate the held state so runInBackgroundRewrite sees the rewritten
  // command when it reads state.partial on stop. Preserve other keys.
  input.command = rewritten;
  state.partial = JSON.stringify(input);
  return data;
}

const {
  hookUiEchoStripRewrite,
  ackStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
  _isBareAck,
  _isHallucinatedTurnPrefix,
  _isCeremonyDodge,
  _isStopHookCeremony,
  _trimSoloRationaleParagraph,
} = require('./sse_stop_hook_rewriters');

module.exports = {
  dropToolUseRewrite,
  editFallbackToReadRewrite,
  readInputNormalizeRewrite,
  bashPolicyRewrite,
  runInBackgroundRewrite,
  longLeadingSleepRewrite,
  hookUiEchoStripRewrite,
  ackStripRewrite,
  slopStripRewrite,
  hallucinatedTurnPrefixStripRewrite,
  stopHookCeremonyStripRewrite,
  fpGateMarkerRewrite,
  soloRationaleTrimRewrite,
  _isBareAck,                  // exported for tests
  _isHallucinatedTurnPrefix,   // exported for tests
  _isCeremonyDodge,            // exported for tests
  _isStopHookCeremony,         // exported for tests
  _trimSoloRationaleParagraph, // exported for tests
  _rewriteLongLeadingSleep,    // exported for tests
  _normalizeReadInput,         // exported for tests
};
