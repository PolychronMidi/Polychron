'use strict';

/* Typed registry for tmp/hme-*.{json,txt,jsonl} state files. Each stored file
 * declares a schema validator, an atomic-write helper, and an optional TTL.
 * Callers go through the registry instead of fs.read/writeFileSync directly,
 * eliminating ad-hoc schema drift across reader/writer sites. */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PROJECT_ROOT } = require('./shared');

const REGISTRY = new Map();

// rationale: tmp/-relative names so PROJECT_ROOT moves don't break entries.
function _absPath(rel, projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, rel);
}

// rationale: atomic write via tmp-then-rename; avoids partial-write races
// readers see either old contents or new, never a half-written file.
function _writeAtomic(absPath, contents) {
  const dir = path.dirname(absPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(absPath)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, absPath);
}

function register({ name, relPath, format, schema, ttlMs }) {
  if (!name) throw new Error('state_registry.register: name required');
  if (!relPath) throw new Error('state_registry.register: relPath required');
  if (!['json', 'jsonl', 'text'].includes(format)) {
    throw new Error(`state_registry.register: unsupported format "${format}"`);
  }
  REGISTRY.set(name, { name, relPath, format, schema: schema || null, ttlMs: ttlMs || null });
}

function _entry(name) {
  const e = REGISTRY.get(name);
  if (!e) throw new Error(`state_registry: unregistered store "${name}"`);
  return e;
}

function read(name, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  const abs = _absPath(e.relPath, projectRoot);
  let raw;
  try { raw = fs.readFileSync(abs, 'utf8'); }
  catch (_err) { return e.format === 'json' ? null : (e.format === 'jsonl' ? [] : ''); }
  if (e.format === 'json') {
    try { return JSON.parse(raw); } catch (_err) { return null; }
  }
  if (e.format === 'jsonl') {
    return raw.split('\n').filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (_err) { return null; }
    }).filter(Boolean);
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
  else if (e.format === 'jsonl') serialized = (value || []).map((v) => JSON.stringify(v)).join('\n') + (value && value.length ? '\n' : '');
  else serialized = String(value || '');
  _writeAtomic(abs, serialized);
}

function append(name, line, projectRoot = PROJECT_ROOT) {
  const e = _entry(name);
  if (e.format !== 'jsonl' && e.format !== 'text') {
    throw new Error(`state_registry[${name}]: append only supported on jsonl/text formats`);
  }
  const abs = _absPath(e.relPath, projectRoot);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, (e.format === 'jsonl' ? JSON.stringify(line) : String(line)) + '\n');
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

module.exports = {
  register,
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
