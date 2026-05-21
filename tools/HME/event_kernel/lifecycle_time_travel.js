'use strict';

/**
 * Passive hook-lifecycle time-travel ledger.
 *
 * LangGraphJS is not vendored in this repo, but the relevant persistence model
 * is simple and stable: every lifecycle phase writes an append-only checkpoint
 * with {thread_id, checkpoint_id, parent_id, values}. This gives HME the same
 * operational affordances LangGraph time travel relies on (state history,
 * replay from a checkpoint, fork from a checkpoint) without adding a runtime
 * dependency to the hook hot path.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const hmePaths = require('../proxy/hme_paths');

const STORE_VERSION = 1;
const LOG_NAME = 'hook-lifecycle-checkpoints.jsonl';

function runtimeDir(root) {
  const absRoot = path.resolve(root || hmePaths.PROJECT_ROOT);
  const absDir = path.resolve(hmePaths.HME_RUNTIME_DIR);
  if (absDir === absRoot || absDir.startsWith(absRoot + path.sep)) return absDir;
  return path.join(absRoot, 'tools', 'HME', 'runtime');
}

function storePath(root) {
  return path.join(runtimeDir(root), LOG_NAME);
}

function safeJson(value, fallback = {}) {
  try { return JSON.parse(value || '{}'); } catch (_err) { return fallback; }
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16);
}

function payloadIdentity(payload = {}) {
  const session = payload.session_id || payload.thread_id || payload.conversation_id || 'no-session';
  const turn = payload.turn_id || payload.message_id || payload.request_id || hash(JSON.stringify(payload).slice(0, 4096));
  return { session: String(session), turn: String(turn) };
}

function threadId({ host = '', event = '', payload = {} }) {
  const id = payloadIdentity(payload);
  return `${host || 'unknown'}:${id.session}:${id.turn}:${event || 'unknown'}`;
}

function appendRow(root, row) {
  const file = storePath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
}

function readRows(root) {
  const file = storePath(root);
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => safeJson(line, null))
      .filter(Boolean);
  } catch (_err) {
    return [];
  }
}

function lastCheckpoint(root, thread_id) {
  let last = null;
  for (const row of readRows(root)) {
    if (row.thread_id === thread_id) last = row;
  }
  return last;
}

function checkpoint({ root, host, event, payload = {}, phase, values = {}, source = 'loop', parent_id = null }) {
  if (!root || !phase) return null;
  const thread_id = values.thread_id || threadId({ host, event, payload });
  const parent = parent_id === null ? (lastCheckpoint(root, thread_id) || {}).checkpoint_id || '' : parent_id || '';
  const created_at = new Date().toISOString();
  const row = {
    version: STORE_VERSION,
    ts: created_at,
    created_at,
    thread_id,
    checkpoint_id: `${Date.now().toString(36)}-${hash(`${thread_id}:${phase}:${created_at}:${Math.random()}`)}`,
    parent_id: parent,
    source,
    phase: String(phase),
    host: host || '',
    event: event || '',
    values: redactValues({ ...values, phase, host, event }),
  };
  appendRow(root, row);
  return row;
}

function redactValues(values) {
  const out = { ...values };
  for (const key of Object.keys(out)) {
    if (/raw|body|prompt|content|stdout|stderr/i.test(key)) {
      const text = typeof out[key] === 'string' ? out[key] : JSON.stringify(out[key] || '');
      out[`${key}_bytes`] = Buffer.byteLength(text);
      out[`${key}_sha256_16`] = hash(text);
      delete out[key];
    }
  }
  return out;
}

function history(root, thread_id) {
  return readRows(root).filter((row) => row.thread_id === thread_id).reverse();
}

function get(root, checkpoint_id) {
  return readRows(root).find((row) => row.checkpoint_id === checkpoint_id) || null;
}

function fork(root, checkpoint_id, patch = {}) {
  const base = get(root, checkpoint_id);
  if (!base) return null;
  const row = {
    ...base,
    ts: new Date().toISOString(),
    created_at: new Date().toISOString(),
    checkpoint_id: `${Date.now().toString(36)}-${hash(`${checkpoint_id}:fork:${JSON.stringify(patch)}:${Math.random()}`)}`,
    parent_id: base.checkpoint_id,
    source: 'fork',
    phase: patch.phase || base.phase,
    values: redactValues({ ...(base.values || {}), ...(patch.values || {}), forked_from: base.checkpoint_id }),
  };
  appendRow(root, row);
  return row;
}

module.exports = { checkpoint, history, get, fork, threadId, storePath, readRows };
