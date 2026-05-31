'use strict';
/**
 * HME event-kernel dispatcher.
 *
 * This is the single source of truth for hook/lifecycle routing. Agent-CLI
 * adapters and the inference proxy call this module instead of maintaining
 * their own Event -> script tables.
 *
 * Current adapters:
 *   - Claude Code hooks: event_kernel/claude_adapter.js -> /hme/lifecycle -> this file
 *   - Codex hooks: event_kernel/codex_adapter.js -> /hme/lifecycle -> this file
 *   - Proxy-down direct mode: host adapter -> this file
 *
 * Dispatch surface:
 *   SessionStart      -> sessionstart.sh
 *   UserPromptSubmit  -> userpromptsubmit.sh
 *   Stop              -> proxy stop_chain
 *   PreToolUse        -> routed by tool_name to native handlers or shell hooks
 *   PermissionRequest -> shared policy gate for Codex approval prompts
 *   PostToolUse       -> log-tool-call.sh + native handlers or shell hooks
 *   PreCompact        -> precompact.sh
 *   PostCompact       -> postcompact.sh
 *
 * Non-derivable route facts (which policy context an event evaluates) live in
 * dispatcher-routes.json, the declared routing contract. `policyContext(event)`
 * reads it so PermissionRequest's reuse of the PreToolUse policy context is an
 * explicit, auditable fact rather than a hardcoded string. The
 * DispatcherRouteContractVerifier diffs that file against the switch below.
 *
 * `dispatchEvent(eventName, stdinJson)` returns `{stdout, stderr, exit_code}`.
 * Adapters translate that into their host CLI protocol.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('../proxy/shared');
const { appendHookExec } = require('../hooks/hook_report');
const { shouldSkipForNestedHooks } = require('../hooks/cwd_guard');
const { preWriteCheck, toHookResponse } = require('../proxy/pre_write_check');
const { isWriteFamilyTool } = require('../proxy/edit_validation');
const stateClient = require('../proxy/session_state_client');
const { normalize } = require('./envelope');
const { recordFailure } = require('../proxy/turn_failure_state');
const { spawnFileInput } = require('./fs_ipc');
const { recordHookCheckpoint } = require('./hook_decision_log');
const nativeHooks = require('./native_hooks');
const { applyOmoLive, observeOmoShadow } = require('../omo_bridge/shadow_runtime');
const { UNIVERSAL_HOOK_ABI } = require('../omo_bridge/universal_event');
const { isStrictMode } = require('../proxy/strict_mode');

const RETRY_STATE = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'tool-retry-guard.json');
const RETRY_LOG = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'tool-retry-guard.jsonl');
const INSPECTION_TOOLS = new Set(['Read', 'Grep', 'Glob']);

// Declared routing contract: non-derivable route facts (policyContext per event).
const ROUTES_FILE = path.join(__dirname, 'dispatcher-routes.json');
let _routeContext = null;
function policyContext(eventName) {
  if (_routeContext === null) {
    _routeContext = {};
    try {
      const data = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
      for (const r of (data.routes || [])) _routeContext[r.event] = r.policyContext;
    } catch (_e) { /* silent-ok: contract missing falls back to caller default */ }
  }
  return Object.prototype.hasOwnProperty.call(_routeContext, eventName)
    ? _routeContext[eventName] : eventName;
}

function _stable(value) {
  if (Array.isArray(value)) return value.map(_stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, _stable(value[key])]));
}

function _attemptDigest(tool, input) {
  return crypto.createHash('sha256').update(JSON.stringify({ tool, input: _stable(input || {}) })).digest('hex').slice(0, 16);
}

function _readRetryState() {
  try { return JSON.parse(fs.readFileSync(RETRY_STATE, 'utf8')); } catch (_e) { return {}; }
}

function _writeRetryState(state) {
  fs.mkdirSync(path.dirname(RETRY_STATE), { recursive: true });
  fs.writeFileSync(RETRY_STATE, `${JSON.stringify(state, null, 2)}\n`);
}

function _logRetry(row) {
  fs.mkdirSync(path.dirname(RETRY_LOG), { recursive: true });
  fs.appendFileSync(RETRY_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
}

function _retryBlock(tool, input) {
  const state = _readRetryState();
  if (INSPECTION_TOOLS.has(tool)) {
    if (state.last_failed_attempt) {
      state.last_failed_attempt.recovery_tool = tool;
      state.last_failed_attempt.recovered_at = new Date().toISOString();
      _writeRetryState(state);
    }
    return null;
  }
  const digest = _attemptDigest(tool, input);
  const last = state.last_failed_attempt || {};
  if (last.digest !== digest || last.recovered_at) return null;
  const reason = `BLOCKED: repeated failed ${tool} attempt without an intervening Read/Grep/Glob or changed input.`;
  _logRetry({ decision: 'block', tool, digest, reason });
  return { stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }), stderr: ' ', exit_code: 0 };
}

function _recordToolFailure(tool, input, response) {
  const state = _readRetryState();
  const digest = _attemptDigest(tool, input);
  state.last_failed_attempt = {
    tool,
    digest,
    input,
    reason: response && (response.stderr || response.error || response.message || JSON.stringify(response).slice(0, 300)),
    ts: new Date().toISOString(),
  };
  _writeRetryState(state);
  _logRetry({ decision: 'record_failure', tool, digest, reason: state.last_failed_attempt.reason });
}

async function _recordLifecycleState(eventName, stdinJson) {
  const env = normalize(stdinJson);
  const sid = env.session_id || '';
  if (eventName === 'SessionStart') await stateClient.call('read', sid);
  if (eventName === 'UserPromptSubmit') await stateClient.call('phase', sid, { phase: 'observe', meta: { event: eventName } });
  if (eventName === 'Stop') await stateClient.call('phase', sid, { phase: 'verify', meta: { event: eventName } });
}

async function _recordPostToolEvidence(stdinJson) {
  const env = normalize(stdinJson);
  const tool = env.tool_name || '';
  const input = env.tool_input || {};
  const response = env.tool_response || {};
  if (tool !== 'Bash' && tool !== 'Read') return;
  const command = tool === 'Bash' ? String(input.command || '') : `Read ${input.file_path || ''}`;
  const excerpt = typeof response === 'string'
    ? response.slice(0, 500)
    : JSON.stringify(response).slice(0, 500);
  const exitCode = Number.isInteger(response.exit_code) ? response.exit_code : null;
  const failed = response && (response.is_error === true || response.error === true || (exitCode !== null && exitCode !== 0));
  if (failed) recordFailure(PROJECT_ROOT, { tool, reason: response.stderr || response.error || `exit ${exitCode}`, command, session_id: env.session_id || '' });
  await stateClient.call('verification-evidence', env.session_id || '', {
    session_id: env.session_id || '',
    command,
    exit_code: exitCode,
    excerpt,
    artifact: input.file_path || '',
    source: `PostToolUse:${tool}`,
  });
}

const HOOKS_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks');
const LIFECYCLE = path.join(HOOKS_DIR, 'lifecycle');
const PRETOOLUSE = path.join(HOOKS_DIR, 'pretooluse');
const POSTTOOLUSE = path.join(HOOKS_DIR, 'posttooluse');

// Tool-name -> pretooluse script.
const PRETOOL_SCRIPTS = {
  Edit: [path.join(PRETOOLUSE, 'pretooluse_edit.sh')],
  MultiEdit: [path.join(PRETOOLUSE, 'pretooluse_edit.sh')],
  Update: [path.join(PRETOOLUSE, 'pretooluse_edit.sh')],
  Write: [path.join(PRETOOLUSE, 'pretooluse_write.sh')],
  Bash: [path.join(PRETOOLUSE, 'pretooluse_bash.sh')],
  Read: [path.join(PRETOOLUSE, 'pretooluse_read.sh')],
  Grep: [path.join(PRETOOLUSE, 'pretooluse_grep.sh')],
};

// Tool-name -> posttooluse scripts (log-tool-call runs for all).
const UNIVERSAL_POSTTOOL = [path.join(HOOKS_DIR, 'log-tool-call.sh')];
const POSTTOOL_SCRIPTS = {
  Bash: [
    path.join(POSTTOOLUSE, 'posttooluse_bash.sh'),
    path.join(POSTTOOLUSE, 'posttooluse_pipeline_kb.sh'),
  ],
  Edit: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  MultiEdit: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  Update: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  Write: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  Read: [path.join(POSTTOOLUSE, 'posttooluse_read_kb.sh')],
};

const NATIVE_PRETOOL = nativeHooks.preToolHandlers;
const NATIVE_POSTTOOL = nativeHooks.postToolHandlers;
const OPENCODE_OBSERVATION_EVENTS = new Set([
  'ChatHeaders',
  'ChatMessagesTransform',
  'ChatParams',
  'ChatSystemTransform',
  'ShellEnv',
  'TextComplete',
]);

/**
 * Invoke a single bash hook with the given stdin payload. Returns a Promise
 * resolving to {stdout, stderr, exit_code}. Never throws -- errors become
 * exit_code=-1 with an error message on stderr.
 */
function _finishHook(eventName, scriptPath, startedAt, result) {
  const code = result.exit_code ?? 0;
  appendHookExec({
    event: eventName || 'hook',
    script: path.basename(scriptPath),
    cwd: process.cwd(),
    session_id: '',
    exit_code: code,
    duration_ms: Date.now() - startedAt,
    stdout_bytes: Buffer.byteLength(result.stdout || ''),
    stderr_bytes: Buffer.byteLength(result.stderr || ''),
  });
  if (code !== 0 && !_policyDecisionOutput(result.stdout || '')) {
    _appendHookFailure(eventName, scriptPath, code, result);
  }
  recordHookCheckpoint(PROJECT_ROOT, 'hook-script', {
    event: eventName || 'hook',
    policy: path.basename(scriptPath),
    decision: code === 0 ? 'ok' : 'error',
    exit_code: code,
    stdout_bytes: Buffer.byteLength(result.stdout || ''),
    stderr_bytes: Buffer.byteLength(result.stderr || ''),
  });
  return result;
}

function _policyDecisionOutput(stdout) {
  return /"decision"\s*:\s*"block"/.test(stdout)
    || /"permissionDecision"\s*:\s*"deny"/.test(stdout);
}

function _appendHookFailure(eventName, scriptPath, code, result) {
  try {
    const file = path.join(PROJECT_ROOT, 'log', 'hme-errors.log');
    const stderr = String(result.stderr || '').replace(/\s+/g, ' ').trim().slice(0, 400);
    const stdout = String(result.stdout || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    const msg = `[${new Date().toISOString()}] [hook-failure] ${eventName}:${path.basename(scriptPath)} exit=${code}`
      + (stderr ? ` stderr=${stderr}` : '')
      + (stdout ? ` stdout=${stdout}` : '');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${msg}\n`);
  } catch (_e) {
    // silent-ok: hook failure mirroring must never cause a second hook failure.
  }
}

function lifecycleContextResult(eventName, result) {
  const stderr = String(result && result.stderr || '').trim();
  if (!stderr || stderr === 'ok') return result;
  if (!new Set(['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact']).has(eventName)) return result;
  if ((result.stdout || '').trim()) return result;
  return {
    stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: eventName, additionalContext: stderr } }),
    stderr: ' ',
    exit_code: result.exit_code || 0,
  };
}

function runHook(scriptPath, stdinJson, timeoutMs = 30_000, eventName = 'hook') {
  const startedAt = Date.now();
  return spawnFileInput('bash', [scriptPath], {
    input: stdinJson,
    timeoutMs,
    label: `${eventName}-${path.basename(scriptPath)}`,
    env: { PROJECT_ROOT, HME_HOOK_EVENT: eventName },
  }).then((result) => lifecycleContextResult(eventName, _finishHook(eventName, scriptPath, startedAt, {
    stdout: result.stdout,
    stderr: result.stderr,
    exit_code: result.exit_code,
  })));
}

/**
 * Run a chain of hooks for a single event. Each hook receives the SAME
 * stdin payload. Outputs concatenate; the first non-zero exit_code is
 * preserved (but remaining hooks still run -- mirrors Claude Code's default
 * hook-chain behavior where later hooks don't depend on earlier exit codes).
 *
 * Exception: hook output containing `{"decision":"block"...}` halts the
 * chain -- a blocking decision from any hook supersedes later hooks.
 */
async function runChain(scripts, stdinJson, timeoutMs = 30_000, eventName = 'hook') {
  let combinedStdout = '';
  let combinedStderr = '';
  let firstNonZeroCode = 0;
  for (const script of scripts) {
    const r = await runHook(script, stdinJson, timeoutMs, eventName);
    combinedStdout += r.stdout;
    combinedStderr += r.stderr;
    if (r.exit_code !== 0 && firstNonZeroCode === 0) firstNonZeroCode = r.exit_code;
    // Early-exit on block decision (stop/pretooluse hooks may emit JSON block).
    if (/\"decision\"\s*:\s*\"block\"/.test(r.stdout)) break;
  }
  // prevent Claude Code from displaying empty stderr as a hook error
  if (!combinedStderr && firstNonZeroCode === 0) combinedStderr = ' ';
  return { stdout: combinedStdout, stderr: combinedStderr, exit_code: firstNonZeroCode };
}

/**
 * Unified policy registry adapter. Loads the registry lazily so a missing
 * policies/ directory or syntax error in a builtin can never break the
 * proxy's request path. Returns { stdout, stderr, exit_code } in the same
 * shape as runChain so callers can treat both paths identically; returns
 * null when no policy fired a deny (caller falls through to bash chain).
 *
 * First-deny-wins: aggregated decision is whichever JS policy fired first.
 * Subsequent policies still run for side effects (matches stop_chain).
 */
async function _runUnifiedPolicies(eventName, toolName, stdinJson) {
  let registry, config;
  try {
    registry = require('../policies/registry');
    config = require('../policies/config');
  } catch (_e) {
    // silent-ok: optional fallback path.
    return null; // policies/ missing or broken -- skip silently, bash gates still run
  }
  try {
    registry.loadBuiltins();
    const cfg = config.get();
    if (cfg.customPoliciesPath) {
      const customPath = path.isAbsolute(cfg.customPoliciesPath)
        ? cfg.customPoliciesPath
        : path.join(PROJECT_ROOT, cfg.customPoliciesPath);
      registry.loadCustom(customPath);
    }
    const policies = registry.matchingFor(eventName, toolName, config);
    if (policies.length === 0) return null;
    let payload;
    try { payload = JSON.parse(stdinJson || '{}'); } catch (_e) { payload = {}; }
    const ctx = {
      toolInput: payload.tool_input || {},
      toolName: payload.tool_name || toolName,
      sessionId: payload.session_id || '',
      payload,
      deny: registry.deny,
      instruct: registry.instruct,
      allow: registry.allow,
      rewrite: registry.rewrite,
      params: {},
    };
    const { firstDeny, instructs, rewrites, errors } = await registry.runChain(policies, ctx);
    let combinedStderr = '';
    for (const e of errors) combinedStderr += `[unified-policies] ${e.policy}: ${e.error}\n`;
    if (firstDeny) {
      let stdout;
      if (eventName === 'PreToolUse') {
        stdout = JSON.stringify({
          hookSpecificOutput: {
            permissionDecision: 'deny',
            permissionDecisionReason: firstDeny.reason,
          },
        });
      } else {
        stdout = JSON.stringify({
          hookSpecificOutput: { additionalContext: firstDeny.reason },
        });
      }
      if (!combinedStderr) combinedStderr = ' ';
      return { stdout, stderr: combinedStderr, exit_code: 0 };
    }
    if (rewrites && rewrites.length && eventName === 'PreToolUse') {
      try {
        const { recordPolicyRewrite } = require('./hook_decision_log');
        recordPolicyRewrite(PROJECT_ROOT, payload, rewrites);
      } catch (_e) { /* silent-ok: telemetry must never block */ }
      const stdout = JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: ctx.toolInput,
          additionalContext: [...rewrites.map((r) => r.message).filter(Boolean), ...instructs.map((i) => i.message)].join('\n'),
        },
      });
      if (!combinedStderr) combinedStderr = ' ';
      return { stdout, stderr: combinedStderr, exit_code: 0 };
    }
    if (instructs.length) {
      const stdout = JSON.stringify({
        hookSpecificOutput: { additionalContext: instructs.map((i) => i.message).join('\n\n') },
      });
      if (!combinedStderr) combinedStderr = ' ';
      return { stdout, stderr: combinedStderr, exit_code: 0 };
    }
    return null;
  } catch (err) {
    // silent-ok: optional fallback path.
    return { stdout: '', stderr: `[unified-policies] crash: ${err.message}\n`, exit_code: 0 };
  }
}

function _opencodeTextCompleteDecision(stdinJson) {
  let payload;
  try { payload = JSON.parse(stdinJson || '{}'); } catch (_e) { payload = {}; }
  const text = String(payload.text || '');
  if (!text) return null;
  try {
    const { _stripSlop } = require('../proxy/sse_slop_rewriter');
    const slop = _stripSlop(text);
    if (slop && Array.isArray(slop.hits) && slop.hits.length > 0 && slop.out !== text) {
      return { stdout: JSON.stringify({ decision: slop.out ? 'modify' : 'drop', text: slop.out || '', reason: `HME slop rewrite: ${slop.hits.join(',')}` }), stderr: ' ', exit_code: 0 };
    }
  } catch (_e) { /* silent-ok: optional slop policy must not break hooks */ }
  try {
    const { evaluateStreamTextBlock } = require('../omo_bridge/stream_text_block_policy');
    const event = {
      abi: UNIVERSAL_HOOK_ABI,
      id: `hme-opencode-text-${payload.session_id || payload.sessionID || 'unknown'}`,
      timestamp: new Date().toISOString(),
      source: { host: 'opencode', adapter: 'dispatcher', rawEventName: 'TextComplete' },
      phase: 'stream.text_block',
      session: { id: payload.session_id || payload.sessionID || 'unknown', agent: 'opencode', provider: 'opencode' },
      stream: { text },
      payload,
    };
    const result = evaluateStreamTextBlock(event, { ctx: {}, slot: null });
    const decision = result && result.decision;
    if (!decision || decision.kind === 'allow') return null;
    if (decision.kind === 'drop') return { stdout: JSON.stringify({ decision: 'drop', reason: decision.reason || 'HME stream text block removed' }), stderr: ' ', exit_code: 0 };
    if (decision.kind === 'rewrite') return { stdout: JSON.stringify({ decision: 'modify', text: decision.text || '', reason: decision.reason || 'HME stream text block rewritten' }), stderr: ' ', exit_code: 0 };
  } catch (_e) { /* silent-ok: optional stream-text policy must not break hooks */ }
  return null;
}

/**
 * Parse tool_name from a pretooluse/posttooluse payload. Claude Code passes
 * `{tool_name: "Edit", tool_input: {...}}` for pretooluse and a similar shape
 * with `tool_response` added for posttooluse. Fall back to '' on parse error.
 */
function _toolName(stdinJson) {
  try {
    const d = JSON.parse(stdinJson);
    return typeof d.tool_name === 'string' ? d.tool_name : '';
  } catch (_) { return ''; }
}

/**
 * Main entry point. Dispatches a Claude Code lifecycle event to the
 * appropriate hook chain, returning the response shape the forwarder
 * relays to Claude's plugin machinery.
 */
async function dispatchEvent(eventName, stdinJson) {
  const empty = stdinJson || '{}';
  if (shouldSkipForNestedHooks(eventName, empty)) return { stdout: '', stderr: ' ', exit_code: 0 };
  await _recordLifecycleState(eventName, empty);
  if (OPENCODE_OBSERVATION_EVENTS.has(eventName)) {
    if (eventName === 'TextComplete') {
      const streamDecision = _opencodeTextCompleteDecision(empty);
      if (streamDecision) return streamDecision;
    }
    const omo = await applyOmoLive(eventName, empty);
    if (omo.status === 'disabled') await observeOmoShadow(eventName, empty);
    return omo.applied && omo.result ? omo.result : { stdout: '', stderr: ' ', exit_code: 0 };
  }
  switch (eventName) {
    case 'SessionStart':
      if (!isStrictMode()) return { stdout: '', stderr: ' ', exit_code: 0 };
      await applyOmoLive('SessionStart', empty);
      await observeOmoShadow('SessionStart', empty);
      return runChain([path.join(LIFECYCLE, 'sessionstart.sh')], empty, 30_000, 'SessionStart');
    case 'UserPromptSubmit':
      return runChain([path.join(LIFECYCLE, 'userpromptsubmit.sh')], empty, 30_000, 'UserPromptSubmit');
    case 'Stop': {
      const omo = await applyOmoLive('Stop', empty);
      if (omo.status === 'disabled') await observeOmoShadow('Stop', empty);
      // stop_chain evaluator: first-deny-wins, shell stages wrapped via shell_policy
      const stopChain = require('../proxy/stop_chain');
      const result = await stopChain.runStopChain(empty);
      // dominance rewriter removed -- was eating deny messages; re-add via enhance only
      if (result && /"decision"\s*:\s*"block"/.test(result.stdout || '')) return result;
      return omo.applied && omo.result ? omo.result : result;
    }
    case 'PreCompact':
      if (!isStrictMode()) return { stdout: '', stderr: ' ', exit_code: 0 };
      return runChain([path.join(LIFECYCLE, 'precompact.sh')], empty, 30_000, 'PreCompact');
    case 'PostCompact':
      if (!isStrictMode()) return { stdout: '', stderr: ' ', exit_code: 0 };
      return runChain([path.join(LIFECYCLE, 'postcompact.sh')], empty, 30_000, 'PostCompact');
    case 'PreToolUse': {
      const omo = await applyOmoLive('PreToolUse', empty);
      if (omo.status === 'disabled') await observeOmoShadow('PreToolUse', empty);
      if (omo.applied && omo.result && /"permissionDecision"\s*:\s*"deny"/.test(omo.result.stdout || '')) return omo.result;
      const activeInput = omo.stdinJson || empty;
      const tool = _toolName(empty);
      const env = normalize(activeInput);
      const retry = _retryBlock(tool, env.tool_input || {});
      if (retry) return retry;
      if (isWriteFamilyTool(tool)) {
        const decision = await preWriteCheck(activeInput);
        const stdout = toHookResponse(decision);
        if (stdout || decision.permissionDecision !== 'allow') return { stdout, stderr: ' ', exit_code: 0 };
      }
      const unifiedRes = await _runUnifiedPolicies('PreToolUse', tool, activeInput);
      if (unifiedRes && unifiedRes.stdout) return unifiedRes;
      if (NATIVE_PRETOOL[tool]) {
        const native = await NATIVE_PRETOOL[tool](activeInput);
        if (native && native.stdout) return native;
        return omo.applied && omo.result ? omo.result : native;
      }
      const scripts = PRETOOL_SCRIPTS[tool] || [];
      // HME primer runs before first HME_* tool each session -- always chain it
      // for any HME_-prefixed tool, the primer self-guards against re-fire.
      if (tool.startsWith('HME_') || tool.startsWith('mcp__HME__')) {
        scripts.unshift(path.join(PRETOOLUSE, 'pretooluse_hme_primer.sh'));
      }
      if (scripts.length === 0) return omo.applied && omo.result ? omo.result : { stdout: '', stderr: ' ', exit_code: 0 };
      const chained = await runChain(scripts, activeInput, 30_000, 'PreToolUse');
      if (chained && chained.stdout) return chained;
      return omo.applied && omo.result ? omo.result : chained;
    }
    case 'PermissionRequest': {
      const omo = await applyOmoLive('PermissionRequest', empty);
      if (omo.status === 'disabled') await observeOmoShadow('PermissionRequest', empty);
      if (omo.applied && omo.result) return omo.result;
      const tool = _toolName(empty);
      // PermissionRequest reuses the PreToolUse policy context -- declared in
      // dispatcher-routes.json, not hardcoded, so the reuse is auditable.
      const unifiedRes = await _runUnifiedPolicies(policyContext('PermissionRequest'), tool, empty);
      return unifiedRes && unifiedRes.stdout ? unifiedRes : { stdout: '', stderr: ' ', exit_code: 0 };
    }
    case 'PostToolUse': {
      await _recordPostToolEvidence(empty);
      await observeOmoShadow('PostToolUse', empty);
      const tool = _toolName(empty);
      const env = normalize(empty);
      const response = env.tool_response || {};
      const exitCode = Number.isInteger(response.exit_code) ? response.exit_code : null;
      if (response && (response.is_error === true || response.error === true || (exitCode !== null && exitCode !== 0))) _recordToolFailure(tool, env.tool_input || {}, response);
      const unifiedRes = await _runUnifiedPolicies('PostToolUse', tool, empty);
      if (unifiedRes && unifiedRes.stdout) return unifiedRes;
      if (NATIVE_POSTTOOL[tool]) {
        const scripts = [...UNIVERSAL_POSTTOOL, ...(POSTTOOL_SCRIPTS[tool] || [])];
        const universal = await runChain(scripts, empty, 30_000, 'PostToolUse');
        const native = await NATIVE_POSTTOOL[tool](empty);
        return {
          stdout: `${universal.stdout || ''}${native.stdout || ''}`,
          stderr: `${universal.stderr || ''}${native.stderr || ''}` || ' ',
          exit_code: universal.exit_code || native.exit_code || 0,
        };
      }
      const scripts = [...UNIVERSAL_POSTTOOL, ...(POSTTOOL_SCRIPTS[tool] || [])];
      return runChain(scripts, empty, 30_000, 'PostToolUse');
    }
    default:
      return {
        stdout: '',
        stderr: `[event_kernel] unknown event: ${eventName}`,
        exit_code: 0,
      };
  }
}

module.exports = { dispatchEvent, runHook, runChain, lifecycleContextResult, policyContext };
