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
 *   - A policy that throws is logged. Mandatory enforcement policies fail
 *     closed; optional side-effect policies fail open so diagnostics do not
 *     wedge the chain.
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
let _unifiedConfig = null;
function _loadUnifiedConfig() {
  if (_unifiedConfig !== null) return _unifiedConfig;
  try {
    _unifiedConfig = require(path.resolve(PROJECT_ROOT, 'tools/HME/policies/config'));
  } catch (_e) {
    // silent-ok: optional fallback path.
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

const MANDATORY_POLICIES = new Set([
  'detectors',
  'anti_patterns',
  'work_checks',
]);

function mandatoryPolicyFailure(name, msg) {
  return deny(
    `STOP-CHAIN INTEGRITY FAILURE: mandatory policy ${name} failed closed instead of allowing stop. ` +
    `Root cause: ${msg}. Fix the stop-chain/policy failure, then re-run the requested work checks before stopping.`
  );
}

const TRACE_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-stop-chain.trace');
const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'stop-detector-verdicts.env');

// Consolidated telemetry surface -- single record() entry that fan-outs
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
function _isCascadeBreakConditions(stdinJson) {
  let payload;
  try { payload = JSON.parse(stdinJson || '{}'); } catch (_e) { return false; }
  const transcript = payload && payload.transcript_path;
  if (!transcript) return false;
  let lines;
  try { lines = fs.readFileSync(transcript, 'utf8').split('\n'); }
  catch (_e) { return false; }
  // Walk events tracking last user text, last assistant text, and the
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
  if (lastUserIdx > lastAssistantIdx) {
    return true;
  }
  return false;
}

async function runStopChain(stdinJson) {
  resetTrace();
  appendTrace('chain_start');

  // Subagent escape: parent-context checks (NEXUS pending commit, EXHAUST
  // protocol, unfinished-task-debt from the primary session) make no sense
  try {
    const payload = JSON.parse(stdinJson || '{}');
    if (payload && payload._hme_subagent === true) {
      appendTrace('subagent_allow');
      return { stdout: '', stderr: '', exit_code: 0 };
    }
  } catch (_e) { /* malformed payload falls through to normal chain */ }

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
    hasPriorDeny: () => firstDeny !== null,
    shared: {},
  };

  for (const name of POLICY_NAMES) {
    appendTrace('enter', name);

    // Honor unified-registry disable: if the user has opted out of this
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
      if (MANDATORY_POLICIES.has(name)) {
        result = mandatoryPolicyFailure(name, msg);
        appendTrace('exit', `${name} load_error_mandatory`);
      } else {
        appendTrace('exit', `${name} load_error_optional`);
        continue;
      }
    }
    if (!result) {
      try {
        result = await policyMod.run(ctx);
      } catch (err) {
        const msg = `threw: ${err.stack || err.message}`;
        combinedStderr += `[stop_chain] ${name}: ${msg}\n`;
        logError(name, msg);
        result = MANDATORY_POLICIES.has(name) ? mandatoryPolicyFailure(name, msg) : allow();
      }
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
    stdout = JSON.stringify({ systemMessage: instructs.join('\n\n') });
  }

  return { stdout, stderr: combinedStderr, exit_code: 0 };
}

module.exports = { runStopChain, deny, instruct, allow };
