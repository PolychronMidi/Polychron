'use strict';
/**
 * Stop-hook policy evaluator. Proxy-native replacement for the
 * tools/HME/hooks/lifecycle/stop.sh sourced-shell-script chain.
 *
 * Each policy is a Node module exporting `{ name, run(ctx) }`. `ctx` carries
 * the parsed payload, project paths, helper factories, and a shared bag for
 * cross-policy state. `run` returns a Decision via `ctx.deny(reason)`,
 * `ctx.instruct(message)`, or `ctx.allow(message?)`.
 *
 * Aggregation rules (lifted from the FailproofAI hook-handler model):
 *   - First `deny` wins. Later policies still execute for side effects
 *     (autocommit, holograph, post_hooks) but their decisions don't override.
 *   - `instruct` messages accumulate; if no deny fires, they fold into a
 *     single block decision so the user still sees them under the current
 *     Claude Code Stop-hook protocol (which lacks a true `instruct` shape
 *     for Stop — block-with-reason is the only user-visible channel).
 *   - `allow` continues silently.
 *   - A policy that throws is logged and treated as `allow` — never crashes
 *     the chain.
 *
 * Process-boundary semantics: pure-JS policies cannot `exit 0` the parent
 * process the way a sourced bash sub-script could. Shell-wrapped policies
 * spawn a child bash process; an `exit 0` inside the child cannot reach the
 * evaluator. The bug class behind the 117ms-silent-finish failure is now
 * structurally impossible.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

// Unified policy registry — used as a configuration overlay so any stop-
// chain policy that ALSO has a unified-registry entry can be enabled/
// disabled via `i/policies disable <name>`. Stop policies whose unified
// names follow the convention <kebab-case> (e.g. nexus-edit-check) map
// to internal names <snake_case> (nexus_edit_check). Mapping is opt-in:
// missing unified entries default to enabled (the prior behavior).
let _unifiedConfig = null;
function _loadUnifiedConfig() {
  if (_unifiedConfig !== null) return _unifiedConfig;
  try {
    _unifiedConfig = require(path.resolve(PROJECT_ROOT, 'tools/HME/policies/config'));
  } catch (_e) {
    _unifiedConfig = false; // sentinel: registry not available
  }
  return _unifiedConfig;
}
function _kebab(name) { return String(name).replace(/_/g, '-'); }
function _isPolicyEnabled(internalName, defaultEnabled = true) {
  const cfg = _loadUnifiedConfig();
  if (!cfg) return defaultEnabled;
  return cfg.isEnabled(_kebab(internalName), defaultEnabled);
}

const POLICY_NAMES = [
  '_preamble',
  'nexus_edit_check',
  'no_conflicts',
  'autocommit',
  'lifesaver',
  'evolver',
  'detectors',
  'anti_patterns',
  'nexus_pending',
  'work_checks',
  'holograph',
  'post_hooks',
];

const TRACE_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-stop-chain.trace');
const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-stop-detector-verdicts.env');

// Consolidated telemetry surface — single record() entry that fan-outs
// to the right files based on category. Replaces the ad-hoc fs.append-
// FileSync to log/hme-errors.log; keeps category=error so LIFESAVER's
// text-scan picks up policy crashes the same as before.
let _telemetry = null;
function _getTelemetry() {
  if (_telemetry !== null) return _telemetry;
  try { _telemetry = require('../../telemetry'); }
  catch (_e) { _telemetry = false; }
  return _telemetry;
}

function nowIso() { return new Date().toISOString(); }

function appendTrace(line, extra) {
  try {
    fs.appendFileSync(TRACE_FILE, `${nowIso()} ${line}${extra ? ' ' + extra : ''}\n`);
  } catch (_e) { /* trace failure is never fatal */ }
}

function resetTrace() {
  try {
    fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
    fs.writeFileSync(TRACE_FILE, '');
  } catch (_e) { /* trace setup failure is never fatal */ }
}

function logError(policyName, message) {
  // Route through the consolidated telemetry module if available; falls
  // back to direct file append if the module isn't loadable. Replaces
  // the prior ad-hoc fs.appendFileSync — keeps the same on-disk shape
  // so LIFESAVER's text-scan still picks up policy crashes.
  const t = _getTelemetry();
  if (t) {
    t.error('stop_chain_policy_error', { policy: policyName, message, ts: nowIso() });
    return;
  }
  // Fallback when telemetry module is missing — preserves prior behavior.
  try {
    const errLog = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
    fs.mkdirSync(path.dirname(errLog), { recursive: true });
    fs.appendFileSync(
      errLog,
      `[${nowIso()}] [stop_chain] policy ${policyName}: ${message}\n`
    );
  } catch (_e) { /* error-log write failure is never fatal */ }
}

function deny(reason)       { return { decision: 'deny', reason: reason || '' }; }
function instruct(message)  { return { decision: 'instruct', message: message || '' }; }
function allow(message)     { return { decision: 'allow', message: message || null }; }

function tryParseJson(s) {
  try { return JSON.parse(s || '{}'); } catch (_e) { return {}; }
}

function loadPolicy(name) {
  return require(path.join(__dirname, 'policies', name));
}

/**
 * Run the Stop chain. Returns the proxy-bridge response shape:
 *   { stdout: <decision-json or empty>, stderr: <accumulated>, exit_code: 0 }
 */
async function runStopChain(stdinJson) {
  resetTrace();
  appendTrace('chain_start');

  // Clear stale detector-verdicts file so a crashed prior run can't leak
  // verdicts into this run. detectors policy will re-create it.
  try { fs.unlinkSync(VERDICTS_FILE); } catch (_e) { /* missing is fine */ }

  let firstDeny = null;
  const instructs = [];
  let combinedStderr = '';

  const ctx = {
    stdinJson: stdinJson || '{}',
    payload: tryParseJson(stdinJson),
    projectRoot: PROJECT_ROOT,
    deny, instruct, allow,
    // Read-only view of "has any earlier policy already denied". Side-effect
    // policies that mutate per-turn state (counters, files written once per
    // user-turn) check this to skip mutations the user will never see —
    // matching the original sourced-chain behavior where `exit 0` from a
    // first-deny stage stopped subsequent stages from running at all.
    hasPriorDeny: () => firstDeny !== null,
    shared: {},
  };

  for (const name of POLICY_NAMES) {
    appendTrace('enter', name);

    // Honor unified-registry disable: if the user has opted out of this
    // policy via `i/policies disable <kebab-name>`, skip evaluation but
    // record the skip in the trace so the chain audit stays complete.
    if (!_isPolicyEnabled(name, true)) {
      appendTrace('exit', `${name} skipped_disabled`);
      continue;
    }

    let result = null;
    let policyMod;
    try {
      policyMod = loadPolicy(name);
    } catch (err) {
      const msg = `failed to load: ${err.message}`;
      combinedStderr += `[stop_chain] ${name}: ${msg}\n`;
      logError(name, msg);
      appendTrace('exit', `${name} load_error`);
      continue;
    }
    try {
      result = await policyMod.run(ctx);
    } catch (err) {
      const msg = `threw: ${err.stack || err.message}`;
      combinedStderr += `[stop_chain] ${name}: ${msg}\n`;
      logError(name, msg);
      result = allow();
    }

    if (!result || !result.decision) {
      result = allow();
    }

    appendTrace('exit', `${name} ${result.decision}`);

    if (result.decision === 'deny') {
      if (!firstDeny) {
        firstDeny = result;
        appendTrace('deny_captured', name);
      } else {
        // Append additional denies to the first deny's reason so the user
        // sees ALL block-worthy alerts on the same Stop, not just the
        // earliest. Pre-fix: only the first deny surfaced; auto-completeness
        // and other later-firing policies were silently swallowed when
        // PSYCHOPATHIC-STOP or anti_patterns won the race. The user's
        // recurring "auto-completeness STILL didn't fire!" scream traces
        // here.
        firstDeny = {
          decision: 'deny',
          reason: `${firstDeny.reason}\n\n---\n\n${result.reason}`,
        };
        appendTrace('deny_appended', name);
      }
      // Later policies still run for their side effects.
    } else if (result.decision === 'instruct' && result.message) {
      instructs.push(result.message);
    }
  }

  appendTrace(
    'chain_end',
    firstDeny ? 'deny' : (instructs.length ? 'instruct' : 'allow')
  );

  let stdout = '';
  if (firstDeny) {
    stdout = JSON.stringify({ decision: 'block', reason: firstDeny.reason });
  } else if (instructs.length) {
    // Stop hook protocol has no native `instruct` channel; fold accumulated
    // instructs into a block so users still see them. Preserves the current
    // user-facing UX of the bash chain (which exclusively used block).
    stdout = JSON.stringify({ decision: 'block', reason: instructs.join('\n\n') });
  }

  return { stdout, stderr: combinedStderr, exit_code: 0 };
}

module.exports = { runStopChain, deny, instruct, allow };
