'use strict';

const fs = require('fs');
const path = require('path');
const { parseJson, decisionFields, reasonHash } = require('./decision_normalizer');

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
  append(path.join(root, 'tools', 'HME', 'runtime', 'hook-decisions.jsonl'), JSON.stringify(summary));
}

module.exports = { hookDecisionSummary, recordHookDecision };
