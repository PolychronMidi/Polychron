'use strict';

const fs = require('fs');
const path = require('path');
const { parseJson, decisionFields, reasonHash } = require('./decision_normalizer');
const hmePaths = require('../proxy/hme_paths');

function runtimeDir(root) {
  const rootText = String(root || '');
  const base = rootText.includes('$') ? hmePaths.PROJECT_ROOT : (root || hmePaths.PROJECT_ROOT);
  const absRoot = path.resolve(base);
  const absDir = path.resolve(hmePaths.HME_RUNTIME_DIR);
  if (absDir === absRoot || absDir.startsWith(absRoot + path.sep)) return absDir;
  return path.join(absRoot, 'tools', 'HME', 'runtime');
}

function append(file, line) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
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
  append(path.join(runtimeDir(root), 'metrics', 'hme-activity.jsonl'), JSON.stringify(row));
}

module.exports = { hookDecisionSummary, recordHookDecision, recordPolicyRewrite };
