'use strict';
/**
 * Two-scope policy configuration. Lookup order (first-defined-wins for
 * scalars; deduplicated union for `enabledOverrides` arrays):
 *
 *   1. {project}/config/policies.local.json (developer-local overrides; gitignored)
 *   2. {project}/config/policies.json       (project-shared config, checked in)
 *
 * Schema:
 *   {
 *     "enabled":  ["policy-name", ...]   // explicit enable, overrides defaultEnabled=false
 *     "disabled": ["policy-name", ...]   // explicit disable, overrides defaultEnabled=true
 *     "params":   { "policy-name": { "key": value, ... } }  // per-policy param override
 *     "customPoliciesPath": "path/to/dir-or-file.js"        // load user policies
 *   }
 *
 * Disable wins over enable when both lists contain the same name (defensive:
 * avoids ambiguity for policies developers explicitly want off).
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');

const RENAMED_POLICIES = Object.freeze({
  'block-character-spam': 'rewrite-character-spam',
  'block-comment-bloat': 'rewrite-comment-bloat',
  'block-comment-ellipsis-stub': 'rewrite-comment-ellipsis-stub',
});

function _scopeFiles() {
  return [
    path.join(PROJECT_ROOT, 'config', 'policies.local.json'),
    path.join(PROJECT_ROOT, 'config', 'policies.json'),
  ];
}

function _readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`[policies/config] ${file} not valid JSON: ${err.message}`);
  }
}

function _normalizeArray(v) {
  if (!v) return [];
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'string' && x.length > 0);
}

function load() {
  const files = _scopeFiles();
  const enabled = new Set();
  const disabled = new Set();
  const params = {};
  const rawScopes = [];
  let customPoliciesPath = null;

  for (const file of files) {
    const cfg = _readJson(file);
    if (!cfg) continue;
    rawScopes.push({ file, cfg });
    for (const n of _normalizeArray(cfg.enabled)) enabled.add(n);
    for (const n of _normalizeArray(cfg.disabled)) disabled.add(n);
    // Params: first file that defines a key wins (no merge -- explicit
    // override, matches FailproofAI's policyParams behavior).
    if (cfg.params && typeof cfg.params === 'object') {
      for (const [name, p] of Object.entries(cfg.params)) {
        if (!(name in params) && p && typeof p === 'object') {
          params[name] = { ...p };
        }
      }
    }
    if (!customPoliciesPath && typeof cfg.customPoliciesPath === 'string') {
      customPoliciesPath = cfg.customPoliciesPath;
    }
  }

  return { enabled, disabled, params, customPoliciesPath, files };
}

let _cached = null;
function get() {
  if (!_cached) _cached = load();
  return _cached;
}

function reset() {
  _cached = null;
}

function isEnabled(name, defaultEnabled) {
  const cfg = get();
  if (cfg.disabled.has(name)) return false;
  if (cfg.enabled.has(name)) return true;
  return Boolean(defaultEnabled);
}

function paramsFor(name, defaults = {}) {
  const cfg = get();
  return { ...defaults, ...(cfg.params[name] || {}) };
}

function _unknownMessage(name, file, kind) {
  const mapped = RENAMED_POLICIES[name];
  return mapped
    ? `${file}: stale ${kind} policy name '${name}' (renamed to '${mapped}')`
    : `${file}: unknown ${kind} policy name '${name}'`;
}

function validateKnownPolicyNames(knownNames) {
  const known = knownNames instanceof Set ? knownNames : new Set(knownNames || []);
  const cfg = get();
  const errors = [];
  for (const file of cfg.files || []) {
    const raw = _readJson(file);
    if (!raw) continue;
    for (const n of _normalizeArray(raw.enabled)) if (!known.has(n)) errors.push(_unknownMessage(n, file, 'enabled'));
    for (const n of _normalizeArray(raw.disabled)) if (!known.has(n)) errors.push(_unknownMessage(n, file, 'disabled'));
    if (raw.params && typeof raw.params === 'object') {
      for (const n of Object.keys(raw.params)) if (!known.has(n)) errors.push(_unknownMessage(n, file, 'params'));
    }
  }
  if (errors.length) throw new Error(`[policies/config] ${errors.join('; ')}`);
  return true;
}

module.exports = {
  load, get, reset, isEnabled, paramsFor, validateKnownPolicyNames, RENAMED_POLICIES,
  // Surface internal scope file paths for the CLI's `paths` subcommand.
  _scopeFiles,
};
