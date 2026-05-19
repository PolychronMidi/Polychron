'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCodexToolLoopGraph, restoreLatestCheckpoint, requiresHumanApproval } = require('../../proxy/codex_tool_loop_graph');

function target(extra = {}) {
  return {
    kind: 'direct',
    hme_correlation_id: 'corr_graph_test',
    hme_session_id: 'sess_graph',
    hme_turn_id: 'turn_graph',
    body: { stream: true },
    ...extra,
  };
}

const readCall = { id: 'call_read', name: 'Read', args: { file_path: 'README.md', limit: 1 } };

test('Codex tool-loop graph routes valid streamed tool calls through visible execution invariant', () => {
  const events = [];
  const decision = runCodexToolLoopGraph({ target: target({ hme_correlation_id: 'corr_valid' }), calls: [readCall] }, { checkpoints: false, record: (event) => events.push(event) });
  assert.equal(decision.action, 'execute_tools');
  assert.equal(decision.invariant, 'visible_progress_required');
  assert.equal(decision.requires_visible_progress, true);
  assert.deepEqual(decision.actionable_calls.map((call) => call.id), ['call_read']);
  assert.equal(events.some((event) => event.kind === 'codex-tool-loop-graph-node' && event.node === 'execute_tools'), true);
});

test('Codex tool-loop graph blocks duplicate tool execution', () => {
  const decision = runCodexToolLoopGraph({ target: target({ hme_correlation_id: 'corr_dup' }), calls: [readCall], executed_call_ids: ['call_read'] }, { checkpoints: false });
  assert.equal(decision.action, 'duplicate_tool_fallback');
  assert.equal(decision.invariant, 'no_duplicate_tool_execution');
  assert.deepEqual(decision.duplicate_call_ids, ['call_read']);
});

test('Codex tool-loop graph returns bounded fallback instead of loop-limit 508 state', () => {
  const decision = runCodexToolLoopGraph({ target: target({ hme_correlation_id: 'corr_depth', tool_loop_depth: 8 }), calls: [readCall] }, { checkpoints: false });
  assert.equal(decision.action, 'bounded_fallback');
  assert.equal(decision.invariant, 'bounded_finalization');
});

test('Codex tool-loop graph models human approval before destructive tools', () => {
  const call = { id: 'call_rm', name: 'Bash', args: { command: 'rm -rf tmp/example' } };
  assert.equal(requiresHumanApproval(call), true);
  const decision = runCodexToolLoopGraph({ target: target({ hme_correlation_id: 'corr_hitl' }), calls: [call], hitl_enabled: true }, { checkpoints: false });
  assert.equal(decision.action, 'interrupt_before_tool');
  assert.equal(decision.invariant, 'human_approval_gate');
  assert.deepEqual(decision.approval_calls.map((item) => item.id), ['call_rm']);
});

test('Codex tool-loop graph writes durable checkpoints with correlation id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-codex-graph-cp-'));
  const jsonl = path.join(dir, 'events.jsonl');
  const { createToolLoopCheckpointer } = require('../../proxy/codex_tool_loop_graph');
  const checkpointer = createToolLoopCheckpointer({ dir, jsonl });
  const decision = runCodexToolLoopGraph({ target: target({ hme_correlation_id: 'corr_checkpoint' }), calls: [readCall] }, { checkpointer });
  assert.equal(decision.action, 'execute_tools');
  assert.match(fs.readFileSync(jsonl, 'utf8'), /corr_checkpoint/);
  const restored = restoreLatestCheckpoint('corr_checkpoint', { dir });
  assert.equal(restored.correlation_id, 'corr_checkpoint');
  assert.equal(restored.node, 'execute_tools');
});
