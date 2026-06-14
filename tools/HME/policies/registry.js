// Unified hook-time policy registry with FailproofAI-style definitions and first-deny wins.
// Builtins/custom policies share discovery, config enablement, matching, and chain execution.

const fs = require('fs');
const path = require('path');
const Decision = require('../event_kernel/decision');

// Resolve PROJECT_ROOT without forcing the proxy/shared.js dependency, so
// this module is usable from CLI contexts that don't import the proxy.
const PROJECT_ROOT = process.env.PROJECT_ROOT
  || path.resolve(__dirname, '..', '..', '..');
const BUILTIN_DIR = path.join(__dirname, 'builtin');

// Decision factories. Same shape used by stop_chain/index.js.
const { deny, instruct, allow, rewrite } = Decision;

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
  if (!['block', 'rewrite', 'mixed'].includes(p.decisionClass)) {
    throw new Error(`policy '${p.name}' must declare decisionClass as block|rewrite|mixed`);
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

// Fail closed when a policy's declared decisionClass contradicts the verbs its
// source can return: a 'block' that only rewrites (or a 'rewrite' that only
function assertDecisionClassMatchesSource(policy, srcPath) {
  let src = '';
  try { src = fs.readFileSync(srcPath, 'utf8'); } catch (_e) { return; }
  const cls = policyDecisionClass(policy);
  const canDeny = /ctx\.deny\b/.test(src);
  const canRewrite = /ctx\.rewrite\b/.test(src);
  if (cls === 'block' && canRewrite && !canDeny) {
    throw new Error(`policy '${policy.name}' declares decisionClass 'block' but only rewrites`);
  }
  if (cls === 'rewrite' && canDeny && !canRewrite) {
    throw new Error(`policy '${policy.name}' declares decisionClass 'rewrite' but only denies`);
  }
}

let _builtinsLoaded = false;
function loadBuiltins() {
  if (_builtinsLoaded) return;
  _builtinsLoaded = true;
  if (!fs.existsSync(BUILTIN_DIR)) return;
  const files = fs.readdirSync(BUILTIN_DIR)
    .filter((f) => f.endsWith('.js') && !f.startsWith('_'))
    .sort();
  const errors = [];
  for (const f of files) {
    const builtinFile = path.join(BUILTIN_DIR, f);
    try {
      const mod = require(builtinFile);
      assertDecisionClassMatchesSource(mod, builtinFile);
      register(mod, `builtin/${f}`);
    } catch (err) {
      errors.push(`[policies] failed to load builtin/${f}: ${err.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

function loadCustom(customPath) {
  if (!customPath) return;
  if (!fs.existsSync(customPath)) throw new Error(`[policies] custom policy path missing: ${customPath}`);
  // Custom policies can be a single file (exporting one policy) or a
  const stat = fs.statSync(customPath);
  if (stat.isFile()) {
    try {
      const mod = require(customPath);
      assertDecisionClassMatchesSource(mod, customPath);
      register(mod, customPath);
    } catch (err) {
      throw new Error(`[policies] failed to load custom ${customPath}: ${err.message}`);
    }
    return;
  }
  if (!stat.isDirectory()) throw new Error(`[policies] custom policy path is neither file nor directory: ${customPath}`);
  const errors = [];
  for (const f of fs.readdirSync(customPath).sort()) {
    if (!f.endsWith('.js') || f.startsWith('_')) continue;
    const full = path.join(customPath, f);
    try {
      const mod = require(full);
      assertDecisionClassMatchesSource(mod, full);
      register(mod, full);
    } catch (err) {
      errors.push(`[policies] failed to load ${full}: ${err.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

function list() {
  return _policies.slice();
}

function get(name) {
  return _byName.get(name) || null;
}

function policyDecisionClass(policy) {
  const p = policy || {};
  return p.decisionClass || 'mixed';
}

// Memoized per config snapshot + policy count so the hot matchingFor path does
// not re-read config files from disk on every hook event. config.get() returns
// a stable cached object until config.reset(), so identity is a safe key.
let _validatedSnapshot = null;
let _validatedPolicyCount = -1;
function validateConfigNames(configResolver) {
  if (!configResolver || typeof configResolver.validateKnownPolicyNames !== 'function') return true;
  const snap = typeof configResolver.get === 'function' ? configResolver.get() : null;
  if (snap && _validatedSnapshot === snap && _validatedPolicyCount === _policies.length) return true;
  configResolver.validateKnownPolicyNames(new Set(_policies.map((p) => p.name)));
  _validatedSnapshot = snap;
  _validatedPolicyCount = _policies.length;
  return true;
}

// Reflexive policy genome: a policy declares its failure modes via an optional
// `genome` block; absent fields derive from the registration shape so every
function genomeInput(policy) {
  const p = policy || {};
  const g = p.genome && typeof p.genome === 'object' ? p.genome : {};
  const decisionClass = policyDecisionClass(p);
  const isRewrite = decisionClass === 'rewrite';
  return {
    name: p.name,
    protects: g.protects || (p.category ? [p.category] : ['coherence']),
    known_false_positives: g.known_false_positives || [],
    fail_open_or_closed: g.fail_open_or_closed || (isRewrite ? 'open' : 'closed'),
    visible_output_allowed: g.visible_output_allowed !== undefined ? g.visible_output_allowed : !isRewrite,
    telemetry_only: g.telemetry_only !== undefined ? g.telemetry_only : isRewrite,
    owner: g.owner || 'HME policies',
    recurrence_test: g.recurrence_test || '',
    retirement_condition: g.retirement_condition || 'retire when noise_events>prevented_failures with no real catch',
  };
}

// Return policies matching event+tool, with config-aware enable/disable.
// Empty tool means hook-level events such as Stop.
function matchingFor(event, tool, configResolver) {
  validateConfigNames(configResolver);
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

// Run a policy chain for one event with first-deny semantics.
// Later policies still execute for side effects, matching stop_chain.
async function runChain(policies, ctx) {
  let firstDeny = null;
  const instructs = [];
  const rewrites = [];
  const errors = [];
  for (const p of policies) {
    let res;
    try {
      res = await p.fn(ctx);
    } catch (err) {
      // silent-ok: policy runtime errors are returned in the structured `errors` array; 
      errors.push({ policy: p.name, error: err.message });
      continue;
    }
    if (!res) continue;
    if (res.decision === 'deny' && !firstDeny) firstDeny = { ...res, policy: p.name };
    else if (res.decision === 'instruct' && res.message) instructs.push({ policy: p.name, message: res.message });
    else if (res.decision === 'rewrite') {
      rewrites.push({ policy: p.name, message: res.message || '', updatedInput: res.updatedInput });
      ctx.toolInput = res.updatedInput;
    }
  }
  return { firstDeny, instructs, rewrites, errors };
}

module.exports = {
  register,
  loadBuiltins,
  loadCustom,
  list,
  get,
  policyDecisionClass,
  assertDecisionClassMatchesSource,
  validateConfigNames,
  genomeInput,
  matchingFor,
  runChain,
  deny,
  instruct,
  allow,
  rewrite,
  PROJECT_ROOT,
  BUILTIN_DIR,
};
