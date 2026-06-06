# Context Capsule: review proxy filter_tools middleware

## artifact
tools/HME/proxy/middleware/03_filter_tools.js -- central proxy middleware that
removes configured tool definitions from outgoing Anthropic payloads. The capsule
also includes the imported tools/HME/proxy/shared/load_env.js environment loader
because _dropSet calls _hmeRequireEnv/requireEnv to load HME_FILTER_TOOLS_DROP.

## goal
Find decision-changing correctness/safety flaws in the central tool-filter path
that could crash requests, leak project configuration across contexts, mutate the
wrong tools, lose cache_control, or undermine the settled policy that ask-peer has
no local tool-deny path and filtering is centralized here. Cite function + fix.

## constraints
Peers are driver forks with full inherited context and live tool access; any tool
filtering is centralized here via HME_FILTER_TOOLS_DROP. Empty/unset drop lists
are documented as no-op. The middleware may run for current and replayed payloads;
it must be deterministic, idempotent per payload, and must call ctx.markDirty()
when payload.tools changes. Review only the source in evidence unless you verify
extra facts with tools.

## rubric
Classify P0/P1/P2. For each finding: function/block, exact failure mode, one-line
fix. Reject style comments and non-shipping preferences. Prefer config-loading,
cache_control preservation, multi-project/session leakage, malformed tool shapes,
and doc/code contract mismatches.

## coverage
included: full source for 03_filter_tools.js including _stripInlineComment,
_dropSet, onRequest, HME_FILTER_TOOLS_DROP parsing, cache_control rescue, and the
imported load_env.js functions parseEnvFile, expandEnvValues, loadEnv,
loadDefaultEnvForRequire, requireEnv, and defaultEnvPath.
excluded: unrelated proxy middleware, ask-peer.sh, team_dispatch_guard.py, and
upstream Claude tool schema semantics beyond what appears in evidence.

## evidence
### tools/HME/proxy/middleware/03_filter_tools.js
```js
'use strict';
const { requireEnv: _hmeRequireEnv } = require('../shared/load_env.js');
/**
 * Drop tool definitions you never use from the request before it reaches
 * Anthropic. The `tools` array is ~60KB on every request -- bigger than
 * the system prompt -- and most projects don't need all 26 default tools
 * Claude Code ships (Google Drive MCP, CronCreate/List/Delete, Monitor,
 * RemoteTrigger, EnterWorktree/ExitWorktree, WebFetch, WebSearch, etc.).
 *
 * Removing a tool means the agent literally cannot call it. This is a
 * STRUCTURAL cut, not behavioral conditioning -- verify your workflow
 * doesn't need a tool before adding it to the filter list.
 *
 * Load order (NN_ prefix): AFTER dump_system (so dumps capture the raw
 * tool list for inspection) and BEFORE HME's injection middleware.
 *
 * Configuration via .env:
 *   HME_FILTER_TOOLS_DROP=tool1,tool2,...   comma-separated tool names
 *                                            to remove from payload.tools
 *
 * Empty / unset -> no-op (zero cost).
 *
 * Tool names match exactly (case-sensitive) against the `name` field in
 * each tool definition. To see the current tool surface:
 *   HME_DUMP_SYSTEM_PROMPT=1 in .env, restart proxy, fire any request,
 *   read tmp/claude-full-payload.json and look at the `tools[].name` list.
 */

const fs = require('fs');
const path = require('path');

function _stripInlineComment(value) {
  return String(value || '').replace(/\s+#.*$/, '').trim();
}

function _dropSet(projectRoot) {
  const raw = [_hmeRequireEnv('HME_FILTER_TOOLS_DROP')];
  try {
    const envPath = path.join(projectRoot || process.cwd(), '.env');
    const text = fs.readFileSync(envPath, 'utf8');
    const line = text.split(/\r?\n/).find((l) => /^\s*HME_FILTER_TOOLS_DROP\s*=/.test(l));
    if (line) raw.push(line.replace(/^\s*HME_FILTER_TOOLS_DROP\s*=\s*/, ''));
  } catch (_err) { /* optional config */ }
  return new Set(raw.flatMap((s) => _stripInlineComment(s).split(',')).map((s) => s.trim()).filter(Boolean));
}

module.exports = {
  name: 'filter_tools',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.tools)) return;
    const DROP_SET = _dropSet(ctx.PROJECT_ROOT);
    if (DROP_SET.size === 0) return;
    const before = payload.tools.length;
    // Rescue cache_control from any dropped tool: Claude Code attaches the
    let rescuedCC = null;
    const kept = payload.tools.filter((t) => {
      const name = t && typeof t.name === 'string' ? t.name : '';
      const drop = DROP_SET.has(name);
      if (drop && t && t.cache_control) rescuedCC = t.cache_control;
      return !drop;
    });
    if (kept.length === before) return;
    if (rescuedCC && kept.length > 0) {
      const last = kept[kept.length - 1];
      if (last && !last.cache_control) last.cache_control = rescuedCC;
    }
    payload.tools = kept;
    ctx.markDirty();
  },
};

```

### tools/HME/proxy/shared/load_env.js
```js
// Shared root .env loader for Node entrypoints.

const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const values = new Map();
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let v = line.slice(eq + 1).trim();
    const hashAt = v.indexOf(' #');
    if (hashAt > -1) v = v.slice(0, hashAt).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    values.set(k, v);
  }
  return values;
}

function expandEnvValues(values) {
  const expanded = new Map();
  const resolving = new Set();
  const resolve = (key) => {
    if (expanded.has(key)) return expanded.get(key);
    if (resolving.has(key)) throw new Error(`cyclic .env interpolation involving ${key}`);
    if (!values.has(key)) throw new Error(`.env references undefined key ${key}`);
    resolving.add(key);
    const raw = values.get(key);
    const value = String(raw).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, ref) => {
      const resolved = resolve(ref);
      if (resolved === undefined || resolved === '') {
        throw new Error(`unresolved .env interpolation ${key} references ${ref}`);
      }
      return String(resolved);
    });
    resolving.delete(key);
    expanded.set(key, value);
    return value;
  };
  for (const key of values.keys()) resolve(key);
  return expanded;
}

function loadEnv(envPath, opts) {
  const overwrite = Boolean(opts && opts.overwrite);
  if (!fs.existsSync(envPath)) throw new Error(`missing required .env at ${envPath}`);
  const values = expandEnvValues(parseEnvFile(envPath));
  let loaded = 0;
  let skipped = 0;
  for (const [k, v] of values.entries()) {
    if (overwrite || process.env[k] === undefined) {
      process.env[k] = v;
      loaded++;
    } else {
      skipped++;
    }
  }
  return { loaded, skipped, error: null };
}

let _defaultEnvLoaded = false;
function loadDefaultEnvForRequire() {
  if (_defaultEnvLoaded) return;
  loadEnv(defaultEnvPath(__dirname));
  _defaultEnvLoaded = true;
}

function requireEnv(key, validator) {
  let value = process.env[key];
  if (value === undefined || value === '') {
    loadDefaultEnvForRequire();
    value = process.env[key];
  }
  if (value === undefined || value === '') {
    throw new Error(`missing required environment key ${key}; declare it in root .env`);
  }
  if (validator && !validator(value)) {
    throw new Error(`invalid environment key ${key}=${JSON.stringify(value)}`);
  }
  return value;
}

function requireEnvInt(key) {
  const value = requireEnv(key);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || String(n) !== String(value).trim()) {
    throw new Error(`invalid integer environment key ${key}=${JSON.stringify(value)}`);
  }
  return n;
}

function requireEnvFloat(key) {
  const value = requireEnv(key);
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid float environment key ${key}=${JSON.stringify(value)}`);
  }
  return n;
}

function requireEnvBool(key) {
  const value = requireEnv(key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`invalid boolean environment key ${key}=${JSON.stringify(process.env[key])}`);
}

function defaultEnvPath(callerDir) {
  return path.resolve(callerDir, '..', '..', '..', '..', '.env');
}

module.exports = {
  loadEnv,
  parseEnvFile,
  requireEnv,
  requireEnvInt,
  requireEnvFloat,
  requireEnvBool,
  defaultEnvPath,
};

```
