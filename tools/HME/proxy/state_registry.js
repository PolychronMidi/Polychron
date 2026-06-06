'use strict';

/* Typed registry for tmp/hme-*.{json,txt,jsonl} state files. Each stored file
 * declares a schema validator, an atomic-write helper, and an optional TTL.
 * Callers go through the registry instead of fs.read/writeFileSync directly,
 * eliminating ad-hoc schema drift across reader/writer sites. */

const fs = require('fs');
const path = require('path');
const _os = require('os');
const { PROJECT_ROOT } = require('./shared');

const REGISTRY = new Map();
const JSONL_PARSE_FAIL = Symbol('jsonl-parse-fail');
const STATE_FILES_REL = path.join('tools', 'HME', 'config', 'state-files.json');
const STATE_FILE_FORMAT_HINTS = {
  'tmp/hme-middleware-processed.jsonl': { name: 'statefile_hme_middleware_processed', format: 'jsonl' },
  'tmp/hme-nexus.state': { name: 'statefile_hme_nexus', format: 'text' },
  'tmp/hme-log-errors.watermark': { name: 'statefile_hme_log_errors_watermark', format: 'text' },
  'tmp/hme-universal-pulse.heartbeat': { name: 'statefile_hme_universal_pulse_heartbeat', format: 'text' },
  'tools/HME/runtime/supervisor-abandoned': { name: 'statefile_supervisor_abandoned', format: 'json' },
  'log/hme-errors.log': { name: 'statefile_hme_errors', format: 'text' },
  'tools/HME/runtime/incidents.jsonl': { name: 'statefile_hme_incidents', format: 'jsonl' },
  'tools/HME/runtime/tool-retry-guard.json': { name: 'statefile_tool_retry_guard', format: 'json' },
  'tools/HME/runtime/tool-retry-guard.jsonl': { name: 'statefile_tool_retry_guard_log', format: 'jsonl' },
  'tools/HME/runtime/lifesaver-injections.jsonl': { name: 'statefile_lifesaver_injections', format: 'jsonl' },
  'tools/HME/runtime/heartbeat-lifesaver.ts': { name: 'statefile_lifesaver_heartbeat', format: 'text' },
  'tools/HME/runtime/coherence-events.jsonl': { name: 'statefile_coherence_events', format: 'jsonl' },
  'tools/HME/runtime/context-metabolism.jsonl': { name: 'statefile_context_metabolism', format: 'jsonl' },
  'tools/HME/runtime/proof-capsules.jsonl': { name: 'statefile_proof_capsules', format: 'jsonl' },
  'tools/HME/runtime/team-dispatch-budget.json': { name: 'statefile_team_dispatch_budget', format: 'json' },
};

// rationale: tmp/-relative names so PROJECT_ROOT moves don't break entries.
function _absPath(rel, projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, rel);
}

// rationale: atomic write via tmp-then-rename; avoids partial-write races
// readers see either old contents or new, never a half-written file.
function _fsyncDir(dir) {
  let dfd;
  try {
    dfd = fs.openSync(dir, 'r');
    fs.fsyncSync(dfd);
  } catch (_err) {
    // silent-ok: directory fsync is best-effort (some platforms/filesystems disallow it)
  } finally {
    if (dfd !== undefined) fs.closeSync(dfd);
  }
}

function _writeAtomic(absPath, contents) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${Date.now()}.tmp`);
  // Mesh-found P1 (state-registry review): crash-DURABLE atomic write, not only
  // visibility-atomic. fsync the temp file before rename AND fsync the parent dir
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, absPath);
  _fsyncDir(dir);
}

function _appendDurable(absPath, contents) {
  const dir = path.dirname(absPath);
  const existed = fs.existsSync(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const fd = fs.openSync(absPath, 'a');
  try {
    fs.writeSync(fd, contents);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (!existed) _fsyncDir(dir);
}

function register({ name, relPath, format, schema, ttlMs, source }) {
  if (!name) throw new Error('state_registry.register: name required');
  if (!relPath) throw new Error('state_registry.register: relPath required');
  if (!['json', 'jsonl', 'text'].includes(format)) {
    throw new Error(`state_registry.register: unsupported format "${format}"`);
  }
  REGISTRY.set(name, { name, relPath, format, schema: schema || null, ttlMs: ttlMs || null, source: source || 'manual' });
}

function _loadStateFiles(projectRoot = PROJECT_ROOT) {
  const file = path.join(projectRoot, STATE_FILES_REL);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data.single_owner) ? data.single_owner : [];
  } catch (_err) {
    // silent-ok: missing/unparseable state-files.json = no registered single-owner store
    return [];
  }
}

function registerFromStateFiles(opts = {}) {
  const projectRoot = opts.projectRoot || PROJECT_ROOT;
  const formatHints = opts.formatHints || STATE_FILE_FORMAT_HINTS;
  const registered = [];
  for (const entry of _loadStateFiles(projectRoot)) {
    const relPath = entry && entry.path;
    if (!relPath || !formatHints[relPath]) continue;
    const hint = formatHints[relPath];
    const name = hint.name;
    if (REGISTRY.has(name)) continue;
    register({ name, relPath, format: hint.format, schema: hint.schema || null, source: 'state-files.json' });
    registered.push(name);
  }
  return registered;
}

function _entry(name) {
  const e = REGISTRY.get(name);
  if (!e) throw new Error(`state_registry: unregistered store "${name}"`);
  return e;
}

function _parseJsonlLine(line) {
  try { return JSON.parse(line); } catch (_err) { return JSONL_PARSE_FAIL; }
}

function _serializeJsonlArray(name, value) {
  if (!Array.isArray(value)) throw new Error(`state_registry[${name}]: jsonl write requires an array`);
  const rows = value.map((v) => JSON.stringify(v));
  return rows.length ? rows.join('\n') + '\n' : '';
}

function read(name, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  const abs = _absPath(e.relPath, projectRoot);
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch (_err) { return e.format === 'json' ? null : (e.format === 'jsonl' ? [] : ''); }
  if (e.format === 'json') {
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_err) { return null; }
    // Mesh-found P1 (state-registry review): the registry exists to KILL schema
    // drift, so a registered schema must gate READS too, not only writes. A
    if (e.schema) {
      try { if (e.schema(parsed)) return null; } catch (_err) { return null; }
    }
    return parsed;
  }
  if (e.format === 'jsonl') {
    return raw.split('\n')
      .filter((line) => line !== '')
      .map(_parseJsonlLine)
      .filter((value) => value !== JSONL_PARSE_FAIL);
  }
  return raw;
}

function write(name, value, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  const abs = _absPath(e.relPath, projectRoot);
  if (e.schema && e.format === 'json') {
    const err = e.schema(value);
    if (err) throw new Error(`state_registry[${name}]: schema rejected value: ${err}`);
  }
  let serialized;
  if (e.format === 'json') serialized = JSON.stringify(value);
  else if (e.format === 'jsonl') serialized = _serializeJsonlArray(name, value);
  else serialized = String(value || '');
  _writeAtomic(abs, serialized);
}

function append(name, line, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  if (e.format !== 'jsonl' && e.format !== 'text') {
    throw new Error(`state_registry[${name}]: append only supported on jsonl/text formats`);
  }
  const abs = _absPath(e.relPath, projectRoot);
  const serialized = e.format === 'jsonl' ? JSON.stringify(line) : String(line);
  _appendDurable(abs, serialized + '\n');
}

function reset(name, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  const abs = _absPath(e.relPath, projectRoot);
  try { fs.unlinkSync(abs); } catch (_err) { /* best-effort */ }
}

function paths(name, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  return { abs: _absPath(e.relPath, projectRoot), rel: e.relPath };
}

function listRegistered() {
  return Array.from(REGISTRY.keys());
}

// rationale: schemas are pure validators returning null on OK or an error string.
function buildShapeSchema(shape) {
  const expectedKeys = Object.keys(shape);
  return (value) => {
    if (value === null || typeof value !== 'object') return 'expected object';
    for (const k of expectedKeys) {
      const expected = shape[k];
      const actual = value[k];
      if (expected === 'number' && typeof actual !== 'number') return `${k} must be number`;
      if (expected === 'string' && typeof actual !== 'string') return `${k} must be string`;
      if (expected === 'boolean' && typeof actual !== 'boolean') return `${k} must be boolean`;
    }
    return null;
  };
}

// rationale: canonical stores registered up front; new stores append here.
register({
  name: 'omni_swap_state',
  relPath: 'tmp/hme-omni-swap-state.json',
  format: 'json',
  schema: buildShapeSchema({ idx: 'number', ts: 'number', fail: 'number', chain: 'string' }),
});

register({ name: 'agent_fingerprint', relPath: 'tmp/hme-agent-fingerprint.txt', format: 'text' });
register({ name: 'agent_tier', relPath: 'tmp/hme-agent-tier.txt', format: 'text' });
register({ name: 'last_deny_reason', relPath: 'tmp/hme-last-deny-reason.txt', format: 'text' });
register({ name: 'middleware_processed', relPath: 'tmp/hme-middleware-processed.jsonl', format: 'jsonl' });
register({ name: 'turn_edits', relPath: 'tmp/hme-turn-edits.txt', format: 'text' });
registerFromStateFiles();

module.exports = {
  register,
  registerFromStateFiles,
  read,
  write,
  append,
  reset,
  paths,
  listRegistered,
  buildShapeSchema,
  _absPath,
  _writeAtomic,
};
