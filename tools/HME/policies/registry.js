'use strict';
/**
 * Unified hook-time policy registry. Adapted from FailproofAI's framework
 * (their `BuiltinPolicyDefinition` shape + three-scope config + first-deny-
 * wins evaluator), narrowed to Polychron's enforcement layers 7–11
 * (PreToolUse / PostToolUse / Stop / proxy middleware).
 *
 * Design intent: every hook-time rule shares the same registration shape
 * (`{name, description, category, defaultEnabled, match: {events, tools},
 * fn(ctx), params?}`) and the same enable/disable contract. Discovery is
 * unified (`i/policies list`); configuration is unified (three-scope JSON
 * files); per-layer dispatchers (stop_chain, pretooluse_bash, middleware)
 * consult this registry to decide whether to run a given policy.
 *
 * Out of scope: ESLint rules, HCI verifiers, boot validators, runtime
 * invariants. Those have load-bearing timing properties incompatible with
 * hook-time evaluation; see the meta-registry roadmap (step 2 of the
 * unification plan) for the cross-layer discovery story.
 *
 * Decision shape (matches stop_chain conventions):
 *   ctx.deny(reason)        → block, first-deny-wins
 *   ctx.instruct(message)   → accumulate as additionalContext (where supported)
 *   ctx.allow(message?)     → continue silently (or with optional message)
 *
 * Match semantics:
 *   - `events: ['PreToolUse']`        → fires only on PreToolUse hook
 *   - `events: ['PreToolUse','PostToolUse']` → fires on both
 *   - `tools: ['Bash']`               → restricts to Bash tool calls
 *   - `tools: ['Edit','Write','MultiEdit']` → fires on any of those
 *   - `tools` omitted                 → all tools
 *
 * Loading:
 *   - Built-in policies live in tools/HME/policies/builtin/*.js
 *   - Custom policies are loaded from `customPoliciesPath` in config
 *   - Underscore-prefixed files (e.g. `_helpers.js`) are skipped
 */

const fs = require('fs');
const path = require('path');

// Resolve PROJECT_ROOT without forcing the proxy/shared.js dependency, so
// this module is usable from CLI contexts that don't import the proxy.
const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');
const BUILTIN_DIR = path.join(__dirname, 'builtin');

// Decision factories. Same shape used by stop_chain/index.js.
function deny(reason)      { return { decision: 'deny', reason: reason || '' }; }
function instruct(message) { return { decision: 'instruct', message: message || '' }; }
function allow(message)    { return { decision: 'allow', message: message || null }; }

// Internal registry. Order = registration order = load order.
const _policies = [];
const _byName = new Map();

function _validatePolicy(p, source) {
  if (!p || typeof p !== 'object') throw new Error(`policy from ${source} must be an object`);
  if (!p.name || typeof p.name !== 'string') throw new Error(`policy from ${source} missing string 'name'`);
  if (!p.fn || typeof p.fn !== 'function') throw new Error(`policy '${p.name}' missing 'fn(ctx)'`);
  if (!p.match || !Array.isArray(p.match.events) || p.match.events.length === 0) {
    throw new Error(`policy '${p.name}' must declare match.events as a non-empty array`);
  }
  if (typeof p.defaultEnabled !== 'boolean') {
    throw new Error(`policy '${p.name}' must declare defaultEnabled as boolean`);
  }
}

function register(policy, source = '<external>') {
  _validatePolicy(policy, source);
  if (_byName.has(policy.name)) {
    throw new Error(`policy name collision: '${policy.name}' already registered`);
  }
  _policies.push(policy);
  _byName.set(policy.name, policy);
  return policy;
}

let _builtinsLoaded = false;
function loadBuiltins() {
  if (_builtinsLoaded) return;
  _builtinsLoaded = true;
  if (!fs.existsSync(BUILTIN_DIR)) return;
  const files = fs.readdirSync(BUILTIN_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
  for (const f of files) {
    try {
      const mod = require(path.join(BUILTIN_DIR, f));
      register(mod, `builtin/${f}`);
    } catch (err) {
      console.error(`[policies] failed to load builtin/${f}: ${err.message}`);
    }
  }
}

function loadCustom(customPath) {
  if (!customPath || !fs.existsSync(customPath)) return;
  // Custom policies can be a single file (exporting one policy) or a
  // directory (each *.js exporting one). Underscore-prefixed files are
  // skipped (helpers convention).
  const stat = fs.statSync(customPath);
  if (stat.isFile()) {
    try {
      const mod = require(customPath);
      register(mod, customPath);
    } catch (err) {
      console.error(`[policies] failed to load custom ${customPath}: ${err.message}`);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  for (const f of fs.readdirSync(customPath).sort()) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    const full = path.join(customPath, f);
    try {
      const mod = require(full);
      register(mod, full);
    } catch (err) {
      console.error(`[policies] failed to load ${full}: ${err.message}`);
    }
  }
}

function list() {
  return _policies.slice();
}

function get(name) {
  return _byName.get(name) || null;
}

/**
 * Return policies matching an event + tool, with config-aware enable/disable.
 * `event` is one of 'PreToolUse', 'PostToolUse', 'Stop', etc. `tool` is
 * the tool name when applicable (or empty for hook-level events like Stop).
 */
function matchingFor(event, tool, configResolver) {
  const out = [];
  for (const p of _policies) {
    if (!p.match.events.includes(event)) continue;
    if (p.match.tools && tool && !p.match.tools.includes(tool)) continue;
    if (configResolver) {
      const enabled = configResolver.isEnabled(p.name, p.defaultEnabled);
      if (!enabled) continue;
    } else if (!p.defaultEnabled) {
      continue;
    }
    out.push(p);
  }
  return out;
}

/**
 * Run a chain of policies for a single event. Returns aggregated result
 * with first-deny semantics (subsequent policies still execute for side
 * effects, matching the stop_chain/index.js model).
 */
async function runChain(policies, ctx) {
  let firstDeny = null;
  const instructs = [];
  const errors = [];
  for (const p of policies) {
    let res;
    try {
      res = await p.fn(ctx);
    } catch (err) {
      errors.push({ policy: p.name, error: err.message });
      continue;
    }
    if (!res) continue;
    if (res.decision === 'deny' && !firstDeny) firstDeny = { ...res, policy: p.name };
    else if (res.decision === 'instruct' && res.message) instructs.push({ policy: p.name, message: res.message });
  }
  return { firstDeny, instructs, errors };
}

module.exports = {
  register,
  loadBuiltins,
  loadCustom,
  list,
  get,
  matchingFor,
  runChain,
  deny,
  instruct,
  allow,
  PROJECT_ROOT,
  BUILTIN_DIR,
};
