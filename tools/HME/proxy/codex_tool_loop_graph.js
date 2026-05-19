'use strict';

const fs = require('fs');
const path = require('path');
const { RUNTIME_DIR } = require('./shared');
const { missingRequiredToolFields } = require('./codex_tool_loop');
const { toolMetadata } = require('./hme_tool_registry');

const MAX_TOOL_LOOP_DEPTH = 8;
const FINALIZE_TOOL_LOOP_DEPTH = MAX_TOOL_LOOP_DEPTH - 1;

function nowIso() { return new Date().toISOString(); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function safeJson(value) { try { return JSON.parse(value || '{}'); } catch (_e) { return {}; } }
function hasText(value) { return String(value || '').trim().length > 0; }

function safeName(value) {
  return String(value || '').replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 180) || `turn_${Date.now()}`;
}

function callId(call) { return call && (call.id || call.call_id || call.item_id || ''); }
function callArgs(call) { return call && call.args && typeof call.args === 'object' ? call.args : {}; }

function callSummary(call) {
  const args = callArgs(call);
  return {
    call_id: callId(call),
    name: call && call.name || '',
    missing: missingRequiredToolFields(call),
    file_path: args.file_path || args.file || '',
    command_preview: String(args.command || args.cmd || '').slice(0, 160),
  };
}

function destructiveBash(command) {
  const cmd = String(command || '');
  return /(^|[;&|]\s*)(rm|unlink|shred|truncate)\b/.test(cmd)
    || /\b(git\s+(reset\s+--hard|clean\s+-[fdx]|checkout\s+[^\n]*--|push\s+(--force|-f)|rebase|filter-branch))\b/.test(cmd)
    || /\b(chmod\s+-R|chown\s+-R|dd\s+if=|mkfs|mount|umount)\b/.test(cmd);
}

function requiresHumanApproval(call) {
  if (!call || typeof call !== 'object') return false;
  const meta = toolMetadata(call.name);
  const approval = meta && meta.hme && meta.hme.approval || 'never';
  if (approval === 'always') return true;
  if (approval === 'destructive' && call.name === 'Bash') {
    const args = callArgs(call);
    return destructiveBash(args.command || args.cmd || '');
  }
  return false;
}

class ToolLoopCheckpointer {
  constructor(opts = {}) {
    this.enabled = opts.enabled !== false;
    this.dir = opts.dir || path.join(RUNTIME_DIR, 'codex-tool-loop-checkpoints');
    this.jsonl = opts.jsonl || path.join(RUNTIME_DIR, 'codex-tool-loop-checkpoints.jsonl');
  }

  snapshot(state, node, extra = {}) {
    const row = {
      ts: nowIso(),
      node,
      correlation_id: state.correlation_id || '',
      session_id: state.session_id || '',
      thread_id: state.thread_id || '',
      turn_id: state.turn_id || '',
      route: state.route || '',
      tool_loop_depth: state.depth || 0,
      finalizing_tool_loop: Boolean(state.finalizing_tool_loop),
      finalization_repairs: state.finalization_repairs || 0,
      response_kind: state.response_kind || '',
      calls: asArray(state.calls).map(callSummary),
      actionable_call_ids: asArray(state.actionable_calls).map(callId).filter(Boolean),
      skipped_call_ids: asArray(state.skipped_calls).map(callId).filter(Boolean),
      duplicate_call_ids: asArray(state.duplicate_call_ids),
      decision: state.decision || '',
      reason: state.reason || '',
      invariant: state.invariant || '',
      ...extra,
    };
    return row;
  }

  write(state, node, extra = {}) {
    if (!this.enabled) return null;
    const row = this.snapshot(state, node, extra);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.jsonl, `${JSON.stringify(row)}\n`);
      fs.writeFileSync(path.join(this.dir, `${safeName(row.correlation_id)}.json`), JSON.stringify(row, null, 2));
    } catch (_e) { /* best effort: observability must not break proxying */ }
    return row;
  }
}

function createToolLoopCheckpointer(opts = {}) {
  return new ToolLoopCheckpointer(opts);
}

function initialState(input = {}) {
  const target = input.target || {};
  const source = input.source || {};
  return {
    node: 'start',
    history: [],
    target,
    parsed: input.parsed || null,
    calls: asArray(input.calls),
    executed_call_ids: new Set(asArray(input.executed_call_ids).filter(Boolean)),
    correlation_id: input.correlation_id || target.hme_correlation_id || '',
    session_id: source.session_id || target.hme_session_id || '',
    thread_id: source.thread_id || target.hme_thread_id || '',
    turn_id: source.turn_id || target.hme_turn_id || '',
    route: target.kind || '',
    depth: Number(target.tool_loop_depth || 0),
    finalizing_tool_loop: Boolean(target.finalizing_tool_loop),
    finalization_repairs: Number(target.finalization_repairs || 0),
    response_kind: input.response_kind || '',
    stream: Boolean(target.body && target.body.stream),
    hitl_enabled: input.hitl_enabled === true,
    actionable_calls: [],
    skipped_calls: [],
    duplicate_call_ids: [],
    approval_calls: [],
    decision: '',
    reason: '',
    invariant: '',
  };
}

function transition(state, node, patch, checkpointer, record) {
  const next = { ...state, ...patch, node, history: [...state.history, node] };
  const checkpoint = checkpointer && checkpointer.write(next, node);
  if (record) record({ kind: 'codex-tool-loop-graph-node', node, correlation_id: next.correlation_id, decision: next.decision || '', reason: next.reason || '', tool_loop_depth: next.depth, calls: next.calls.length });
  return { state: next, checkpoint };
}

function inspectNode(state) {
  const actionable = [];
  const skipped = [];
  const duplicate = [];
  for (const call of state.calls) {
    const id = callId(call);
    if (id && state.executed_call_ids.has(id)) duplicate.push(id);
    if (missingRequiredToolFields(call).length) skipped.push(call);
    else actionable.push(call);
  }
  return { actionable_calls: actionable, skipped_calls: skipped, duplicate_call_ids: duplicate };
}

function routeNode(state) {
  if (!state.calls.length) return { decision: 'final', reason: 'no tool calls' };
  if (state.duplicate_call_ids.length) return { decision: 'duplicate_tool_fallback', reason: 'tool call id already executed', invariant: 'no_duplicate_tool_execution' };
  if (state.finalizing_tool_loop && state.calls.length) {
    if (state.finalization_repairs >= 1) return { decision: 'finalization_fallback', reason: 'finalization emitted tools after repair', invariant: 'bounded_finalization' };
    return { decision: 'finalization_repair', reason: 'finalization emitted tool calls', invariant: 'no_raw_tool_leakage' };
  }
  if (!state.actionable_calls.length) return { decision: 'malformed_tool_fallback', reason: 'all tool calls are missing required fields', invariant: 'no_raw_tool_leakage' };
  if (state.depth >= MAX_TOOL_LOOP_DEPTH) return { decision: 'bounded_fallback', reason: 'tool loop depth limit reached', invariant: 'bounded_finalization' };
  const approval = state.hitl_enabled ? state.actionable_calls.filter(requiresHumanApproval) : [];
  if (approval.length) return { decision: 'interrupt_before_tool', reason: 'human approval required before destructive tool', approval_calls: approval, invariant: 'human_approval_gate' };
  return { decision: 'execute_tools', reason: 'valid tool calls available', invariant: state.stream ? 'visible_progress_required' : 'tool_execution' };
}

function decisionFromState(state, checkpoint) {
  return {
    action: state.decision,
    reason: state.reason,
    invariant: state.invariant,
    checkpoint,
    depth: state.depth,
    next_depth: state.depth + 1,
    finalizing: state.decision === 'execute_tools' && state.depth >= FINALIZE_TOOL_LOOP_DEPTH,
    actionable_calls: state.actionable_calls,
    skipped_calls: state.skipped_calls,
    duplicate_call_ids: state.duplicate_call_ids,
    approval_calls: state.approval_calls || [],
    calls: state.calls,
    requires_visible_progress: state.stream && state.decision === 'execute_tools',
    checkpoint_id: checkpoint && `${checkpoint.correlation_id}:${checkpoint.node}:${checkpoint.ts}`,
  };
}

function runCodexToolLoopGraph(input = {}, opts = {}) {
  const checkpointer = opts.checkpointer || createToolLoopCheckpointer({ enabled: opts.checkpoints !== false });
  const record = typeof opts.record === 'function' ? opts.record : null;
  let state = initialState({ ...input, hitl_enabled: input.hitl_enabled === true || process.env.HME_CODEX_HITL === '1' });
  let step = transition(state, 'inspect_response', inspectNode(state), checkpointer, record);
  state = step.state;
  const route = routeNode(state);
  step = transition(state, route.decision, route, checkpointer, record);
  state = step.state;
  return decisionFromState(state, step.checkpoint);
}

function restoreLatestCheckpoint(correlationId, opts = {}) {
  const dir = opts.dir || path.join(RUNTIME_DIR, 'codex-tool-loop-checkpoints');
  const file = path.join(dir, `${safeName(correlationId)}.json`);
  try { return safeJson(fs.readFileSync(file, 'utf8')); }
  catch (_e) { return null; }
}

module.exports = {
  MAX_TOOL_LOOP_DEPTH,
  FINALIZE_TOOL_LOOP_DEPTH,
  ToolLoopCheckpointer,
  createToolLoopCheckpointer,
  runCodexToolLoopGraph,
  restoreLatestCheckpoint,
  requiresHumanApproval,
};
