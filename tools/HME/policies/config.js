'use strict';
/**
 * Three-scope policy configuration. Adapted from FailproofAI's hooks-config
 * shape. Lookup order (first-defined-wins for scalars; deduplicated union
 * for `enabledOverrides` arrays):
 *
 *   1. {project}/.hme/policies.local.json   (developer-local overrides)
 *   2. {project}/.hme/policies.json         (project-shared config, checked in)
 *   3. ~/.hme/policies.json                 (user-global defaults)
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
const os = require('os');

const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');

function _scopeFiles() {
  return [
    path.join(PROJECT_ROOT, '.hme', 'policies.local.json'),
    path.join(PROJECT_ROOT, '.hme', 'policies.json'),
    path.join(os.homedir(), '.hme', 'policies.json'),
  ];
}

function _readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[policies/config] ${file} not valid JSON: ${err.message}`);
    return null;
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
  let customPoliciesPath = null;

  for (const file of files) {
    const cfg = _readJson(file);
    if (!cfg) continue;
    for (const n of _normalizeArray(cfg.enabled)) enabled.add(n);
    for (const n of _normalizeArray(cfg.disabled)) disabled.add(n);
    // Params: first file that defines a key wins (no merge — explicit
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

module.exports = {
  load, get, reset, isEnabled, paramsFor,
  // Surface internal scope file paths for the CLI's `paths` subcommand.
  _scopeFiles,
};
