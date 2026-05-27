'use strict';

const fs = require('fs');
const path = require('path');
const { parseJson, decisionFields, reasonHash } = require('./decision_normalizer');
const hmePaths = require('../proxy/infra/hme_paths');
const { appendLine } = require('../proxy/infra/bounded_log');

function runtimeDir(root) {
  const rootText = String(root || '');
  const base = rootText.includes('$') ? hmePaths.PROJECT_ROOT : (root || hmePaths.PROJECT_ROOT);
  const absRoot = path.resolve(base);
  const absDir = path.resolve(hmePaths.HME_RUNTIME_DIR);
  if (absDir === absRoot || absDir.startsWith(absRoot + path.sep)) return absDir;
  return path.join(absRoot, 'tools', 'HME', 'runtime');
}

function append(file, line) {
  appendLine(file, line);
}

function hookDecisionSummary(host, event, rawStdout, sanitizedStdout, payload = {}) {
  const raw = parseJson(rawStdout);
  const clean = parseJson(sanitizedStdout);
  const rawFields = decisionFields(raw);
  const cleanFields = decisionFields(clean);
  const reason = cleanFields.reason || rawFields.reason;
  const decision = cleanFields.decision || rawFields.decision;
  if (!reason && (!decision || decision === 'allow')) return null;
  return {
    ts: new Date().toISOString(),
    host,
    event,
    tool: payload.tool_name || '',
    session_id: payload.session_id || '',
    decision: decision || '',
    reason_hash: reasonHash(reason),
    surfaced_channels: cleanFields.channels,
    raw_channels: rawFields.channels,
    duplicate_systemMessage_stripped: Boolean(raw.systemMessage && raw.systemMessage === rawFields.reason && !clean.systemMessage),
  };
}

function recordHookDecision(root, host, event, rawStdout, sanitizedStdout, payload = {}) {
  const summary = hookDecisionSummary(host, event, rawStdout, sanitizedStdout, payload);
  if (!summary || !root) return;
  append(path.join(runtimeDir(root), 'hook-decisions.jsonl'), JSON.stringify(summary));
}


function denyStormOverride(root, host, event, rawStdout, sanitizedStdout, payload = {}) {
  const summary = hookDecisionSummary(host, event, rawStdout, sanitizedStdout, payload);
  if (!summary || summary.decision !== 'deny' || !summary.reason_hash || !root) return '';
  const dir = runtimeDir(root);
  const stateFile = path.join(dir, 'hook-deny-storm.json');
  let state = {};
  try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch (_e) { state = {}; }
  const key = [host, event, summary.tool, summary.session_id, summary.reason_hash].join('|');
  const now = Date.now();
  const prev = state[key] || {};
  const close = now - Number(prev.ts_ms || 0) < 120_000;
  const count = close ? Number(prev.count || 1) + 1 : 1;
  state[key] = { ts_ms: now, count };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
  if (count < 2) return '';
  const reason = `BLOCKED: repeated ${summary.tool || 'tool'} denial (${summary.reason_hash}) without recovery. Stop retrying the same denied action; inspect/read/re-plan or change the input.`;
  append(path.join(dir, 'hook-deny-storm.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...summary, storm_count: count, storm_key: key, override_reason: reason }));
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: reason } });
}

function recordHookCheckpoint(root, stage, fields = {}) {
  if (!root || !stage) return;
  const row = {
    ts: new Date().toISOString(),
    stage: String(stage),
    host: fields.host || '',
    event: fields.event || '',
    policy: fields.policy || '',
    decision: fields.decision || '',
    exit_code: Number.isInteger(fields.exit_code) ? fields.exit_code : null,
    stdout_bytes: Number(fields.stdout_bytes || 0),
    stderr_bytes: Number(fields.stderr_bytes || 0),
    reason_hash: fields.reason ? reasonHash(String(fields.reason)) : '',
  };
  append(path.join(runtimeDir(root), 'hook-checkpoints.jsonl'), JSON.stringify(row));
}

function recordPolicyRewrite(root, payload = {}, rewrites = []) {
  if (!root || !Array.isArray(rewrites) || rewrites.length === 0) return;
  const row = {
    ts: Math.floor(Date.now() / 1000),
    ts_iso: new Date().toISOString(),
    event: 'policy_rewrite',
    kind: 'policy_rewrite',
    host: payload._hme_host || '',
    tool: payload.tool_name || '',
    session_id: payload.session_id || '',
    count: rewrites.length,
    policies: rewrites.map((r) => r.policy).filter(Boolean),
    last_message: String((rewrites[rewrites.length - 1] || {}).message || '').slice(0, 240),
  };
  append(path.join(runtimeDir(root), 'hook-decisions.jsonl'), JSON.stringify(row));
}

module.exports = { hookDecisionSummary, recordHookDecision, denyStormOverride, recordHookCheckpoint, recordPolicyRewrite };
