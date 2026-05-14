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
 *     for Stop -- block-with-reason is the only user-visible channel).
 *   - `allow` continues silently.
 *   - A policy that throws is logged and treated as `allow` -- never crashes
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

// Unified policy registry -- used as a configuration overlay so any stop-
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

// Consolidated telemetry surface -- single record() entry that fan-outs
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
  // the prior ad-hoc fs.appendFileSync -- keeps the same on-disk shape
  // so LIFESAVER's text-scan still picks up policy crashes.
  const t = _getTelemetry();
  if (t) {
    t.error('stop_chain_policy_error', { policy: policyName, message, ts: nowIso() });
    return;
  }
  // Fallback when telemetry module is missing -- preserves prior behavior.
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
  // Hot-reload: policies are small + edited frequently while iterating on
  // the doctrine. Long-running proxy daemons would otherwise serve stale
  // policy code until restart, producing the "I edited but it didn't take
  // effect" failure mode (caught when summary_format demotion didn't
  // reach the running proxy). Bust the cache for the policy module + its
  // immediate dependencies under policies/ so each Stop event picks up
  // the current source.
  const policyPath = require.resolve(path.join(__dirname, 'policies', name));
  delete require.cache[policyPath];
  // Also bust any cached siblings under policies/ that the policy may
  // re-require. Cheap: typically <20 modules total.
  const policiesDir = path.join(__dirname, 'policies');
  for (const cached of Object.keys(require.cache)) {
    if (cached.startsWith(policiesDir + path.sep)) {
      delete require.cache[cached];
    }
  }
  return require(policyPath);
}

/**
 * Run the Stop chain. Returns the event-kernel response shape:
 *   { stdout: <decision-json or empty>, stderr: <accumulated>, exit_code: 0 }
 */
// Cascade-break: when the prior user message is a stop-hook deny payload
// AND the assistant's reply is a bare ack, every detector in the chain
// will fire on something (advisor doctrine, stop_work TEXT_ONLY_SHORT,
// auto-completeness, etc.) -- producing endless "you must respond" loops
// the agent cannot exit because every shape of output triggers a fresh
// fire. Short-circuit the entire chain to `allow` for that exact pattern.
// Silence is achieved by recognizing the silence-equivalent.
function _isCascadeBreakConditions(stdinJson) {
  let payload;
  try { payload = JSON.parse(stdinJson || '{}'); } catch (_e) { return false; }
  const transcript = payload && payload.transcript_path;
  if (!transcript) return false;
  let lines;
  try { lines = fs.readFileSync(transcript, 'utf8').split('\n'); }
  catch (_e) { return false; }
  // Walk events tracking last user text, last assistant text, and the
  // index of each so we can detect "user-deny is the most recent event
  // with no assistant flushed after it" (the write-race shape).
  let lastUserText = '';
  let lastUserIdx = -1;
  let lastAssistantText = '';
  let lastAssistantIdx = -1;
  let lastAssistantHadToolUse = false;
  let evIdx = 0;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    const content = (entry.message && entry.message.content) || entry.content;
    if (role === 'user') {
      let text = '';
      if (typeof content === 'string') text = content;
      else if (Array.isArray(content)) {
        text = content
          .filter((b) => b && b.type === 'text')
          .map((b) => b.text || '')
          .join(' ');
      }
      if (text.trim()) {
        lastUserText = text;
        lastUserIdx = evIdx;
      }
    } else if (role === 'assistant') {
      let text = '';
      let hasToolUse = false;
      if (Array.isArray(content)) {
        for (const b of content) {
          if (!b || typeof b !== 'object') continue;
          if (b.type === 'tool_use') hasToolUse = true;
          if (b.type === 'text' && typeof b.text === 'string') text += b.text;
        }
      } else if (typeof content === 'string') {
        text = content;
      }
      // Only update when the assistant event has visible text content;
      // pure-thinking events don't reset lastAssistantText since the
      // text usually arrives in a sibling event.
      if (text.trim() || hasToolUse) {
        lastAssistantText = text;
        lastAssistantHadToolUse = hasToolUse;
        lastAssistantIdx = evIdx;
      }
    }
    evIdx++;
  }
  const userIsDeny = lastUserText && [
    'Stop hook feedback:',
    'Stop hook blocking error from command:',
    'AUTO-COMPLETENESS',
    'PreToolUse:',
    'PostToolUse:',
  ].some((m) => lastUserText.includes(m));
  if (!userIsDeny) return false;
  // Case 1: agent's reply is on disk and is a bare ack -- the original
  // cascade-break shape.
  if (!lastAssistantHadToolUse && lastAssistantIdx > lastUserIdx) {
    const trimmed = (lastAssistantText || '').trim().toLowerCase().replace(/[.!]+$/, '');
    if (['ok', 'done', 'noted', 'got it', 'ack', 'acknowledged'].includes(trimmed)) {
      return true;
    }
  }
  // Case 2: write-race -- the deny is the most recent event in the
  // transcript with no assistant event flushed after it. The Stop hook
  // fires immediately at agent turn-end; Claude Code may not have
  // written the assistant response to disk yet. The chain is necessarily
  // running in response to an agent turn that just ended. Treat that
  // shape as "agent emitted SOMETHING, presumed bare ack" -- silence-
  // equivalent. Risk: a substantive agent reply that lands during the
  // race window also bypasses, but the chain re-evaluates next turn so
  // any persistent issue still surfaces. The cost of NOT short-circuiting
  // (cascade loop the agent cannot exit) is structurally worse.
  if (lastUserIdx > lastAssistantIdx) {
    return true;
  }
  return false;
}

async function runStopChain(stdinJson) {
  resetTrace();
  appendTrace('chain_start');

  // Cascade-break: silence-equivalent ack of a deny payload short-circuits
  // the entire chain. No policies run, no detectors fire, turn ends.
  if (_isCascadeBreakConditions(stdinJson)) {
    appendTrace('cascade_break');
    return { stdout: '', stderr: '', exit_code: 0 };
  }

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
    // user-turn) check this to skip mutations the user will never see --
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
