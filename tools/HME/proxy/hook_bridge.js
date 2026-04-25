'use strict';
/**
 * Lifecycle event bridge: Claude Code hooks → proxy-native dispatch.
 *
 * The ONLY Claude-Code-side script is tools/HME/hooks/_proxy_bridge.sh — a
 * 10-line forwarder that POSTs whatever stdin it receives to
 *   POST /hme/lifecycle?event=<EventName>
 * and relays the response JSON back to Claude Code's plugin machinery
 * (stdout/stderr/exit_code).
 *
 * This module owns the proxy-side dispatch:
 *   SessionStart      → sessionstart.sh
 *   UserPromptSubmit  → userpromptsubmit.sh
 *   Stop              → stop.sh
 *   PreToolUse        → routed by tool_name to pretooluse_<tool>.sh (+ primer)
 *   PostToolUse       → log-tool-call.sh + routed posttool hooks
 *   PreCompact        → precompact.sh
 *   PostCompact       → postcompact.sh
 *
 * Everything funnels through `dispatchEvent(eventName, stdinJson)` which
 * returns `{stdout, stderr, exit_code}` — the shape the forwarder sends
 * back to Claude Code.
 *
 * This replaces the three direct-function calls the proxy made in a
 * previous iteration (runSessionStart / runUserPromptSubmit / runStop).
 * Every path now goes through the same HTTP endpoint, so telemetry,
 * middleware, and external callers all see the same surface.
 */

const { spawn } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const HOOKS_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks');
const LIFECYCLE = path.join(HOOKS_DIR, 'lifecycle');
const PRETOOLUSE = path.join(HOOKS_DIR, 'pretooluse');
const POSTTOOLUSE = path.join(HOOKS_DIR, 'posttooluse');

// Tool-name → pretooluse script.
const PRETOOL_SCRIPTS = {
  Edit: [path.join(PRETOOLUSE, 'pretooluse_edit.sh')],
  MultiEdit: [path.join(PRETOOLUSE, 'pretooluse_edit.sh')],
  Write: [path.join(PRETOOLUSE, 'pretooluse_write.sh')],
  Bash: [path.join(PRETOOLUSE, 'pretooluse_bash.sh')],
  Read: [path.join(PRETOOLUSE, 'pretooluse_read.sh')],
  Grep: [path.join(PRETOOLUSE, 'pretooluse_grep.sh')],
  Glob: [path.join(PRETOOLUSE, 'pretooluse_glob.sh')],
  TodoWrite: [path.join(PRETOOLUSE, 'pretooluse_todowrite.sh')],
  ToolSearch: [path.join(PRETOOLUSE, 'pretooluse_toolsearch.sh')],
};

// Tool-name → posttooluse scripts (log-tool-call runs for all).
const UNIVERSAL_POSTTOOL = [path.join(HOOKS_DIR, 'log-tool-call.sh')];
const POSTTOOL_SCRIPTS = {
  Bash: [
    path.join(POSTTOOLUSE, 'posttooluse_bash.sh'),
    path.join(POSTTOOLUSE, 'posttooluse_pipeline_kb.sh'),
  ],
  Edit: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  MultiEdit: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  Write: [path.join(POSTTOOLUSE, 'posttooluse_edit.sh')],
  Read: [path.join(POSTTOOLUSE, 'posttooluse_read_kb.sh')],
  TodoWrite: [path.join(POSTTOOLUSE, 'posttooluse_todowrite.sh')],
};

/**
 * Invoke a single bash hook with the given stdin payload. Returns a Promise
 * resolving to {stdout, stderr, exit_code}. Never throws — errors become
 * exit_code=-1 with an error message on stderr.
 */
function runHook(scriptPath, stdinJson, timeoutMs = 30_000) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('bash', [scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PROJECT_ROOT },
      });
    } catch (err) {
      resolve({ stdout: '', stderr: `[hook_bridge] spawn failed for ${scriptPath}: ${err.message}`, exit_code: -1 });
      return;
    }
    let stdout = '';
    let stderr = '';
    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_) { /* ignore */ }
      resolve({ stdout, stderr: stderr + `\n[hook_bridge] timeout after ${timeoutMs}ms: ${scriptPath}`, exit_code: -1 });
    }, timeoutMs);
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\n[hook_bridge] error: ${err.message}`, exit_code: -1 });
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, exit_code: code ?? 0 });
    });
    try {
      child.stdin.write(stdinJson);
      child.stdin.end();
    } catch (err) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ stdout, stderr: `[hook_bridge] stdin write failed: ${err.message}`, exit_code: -1 });
    }
  });
}

/**
 * Run a chain of hooks for a single event. Each hook receives the SAME
 * stdin payload. Outputs concatenate; the first non-zero exit_code is
 * preserved (but remaining hooks still run — mirrors Claude Code's default
 * hook-chain behavior where later hooks don't depend on earlier exit codes).
 *
 * Exception: hook output containing `{"decision":"block"...}` halts the
 * chain — a blocking decision from any hook supersedes later hooks.
 */
async function runChain(scripts, stdinJson, timeoutMs = 30_000) {
  let combinedStdout = '';
  let combinedStderr = '';
  let firstNonZeroCode = 0;
  for (const script of scripts) {
    const r = await runHook(script, stdinJson, timeoutMs);
    combinedStdout += r.stdout;
    combinedStderr += r.stderr;
    if (r.exit_code !== 0 && firstNonZeroCode === 0) firstNonZeroCode = r.exit_code;
    // Early-exit on block decision (stop/pretooluse hooks may emit JSON block).
    if (/\"decision\"\s*:\s*\"block\"/.test(r.stdout)) break;
  }
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
    return null; // policies/ missing or broken — skip silently, bash gates still run
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
      params: {},
    };
    const { firstDeny, instructs, errors } = await registry.runChain(policies, ctx);
    let combinedStderr = '';
    for (const e of errors) combinedStderr += `[unified-policies] ${e.policy}: ${e.error}\n`;
    if (firstDeny) {
      // PreToolUse uses Claude Code's permissionDecision shape; PostToolUse uses additionalContext.
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
      return { stdout, stderr: combinedStderr, exit_code: 0 };
    }
    if (instructs.length) {
      const stdout = JSON.stringify({
        hookSpecificOutput: { additionalContext: instructs.map((i) => i.message).join('\n\n') },
      });
      return { stdout, stderr: combinedStderr, exit_code: 0 };
    }
    return null;
  } catch (err) {
    return { stdout: '', stderr: `[unified-policies] crash: ${err.message}\n`, exit_code: 0 };
  }
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
  switch (eventName) {
    case 'SessionStart':
      return runChain([path.join(LIFECYCLE, 'sessionstart.sh')], empty);
    case 'UserPromptSubmit':
      return runChain([path.join(LIFECYCLE, 'userpromptsubmit.sh')], empty);
    case 'Stop': {
      // Stop chain runs via the proxy-native policy evaluator (stop_chain/).
      // Each stage is a JS module returning {decision, reason}; the
      // evaluator aggregates with first-deny-wins + instruct-accumulate
      // semantics. Bash stages are wrapped via shell_policy so an `exit 0`
      // from a child process cannot bypass the chain (the failure mode that
      // killed the previous chain mid-flight). Pure JS for the gates that
      // emit blocks; transitional shell wrappers for the side-effect-heavy
      // stages until they get ported.
      const stopChain = require('./stop_chain');
      const result = await stopChain.runStopChain(empty);
      // Dominance layer (feature-flagged via HME_DOMINANCE=1): rewrite
      // demand-register stop-hook imperatives (NEXUS block / LIFESAVER
      // banner / AUTO-COMPLETENESS INJECT / exhaust_check) into compact
      // reveal-register `additionalContext` cards so the agent reads
      // "the tool queued action X" rather than "you MUST do X". No-op
      // when the flag is off.
      try {
        const rewriter = require('./middleware/dominance_response_rewriter');
        if (typeof rewriter.rewriteStopOutput === 'function') {
          const rewritten = rewriter.rewriteStopOutput(result.stdout);
          if (rewritten && rewritten !== result.stdout) {
            result.stdout = rewritten;
          }
        }
      } catch (err) {
        // Silent no-op: rewriter absence must not break the stop chain.
        console.error(`[hook_bridge] dominance rewriter error: ${err.message}`);
      }
      return result;
    }
    case 'PreCompact':
      return runChain([path.join(LIFECYCLE, 'precompact.sh')], empty);
    case 'PostCompact':
      return runChain([path.join(LIFECYCLE, 'postcompact.sh')], empty);
    case 'PreToolUse': {
      const tool = _toolName(empty);
      // Unified registry: run any JS-implemented PreToolUse policies that
      // match this tool BEFORE shelling to bash gates. First deny short-
      // circuits the bash chain too — saves a subprocess spawn when the
      // JS layer already blocks. Disabled policies are skipped via the
      // three-scope config (i/policies disable <name>).
      const unifiedRes = await _runUnifiedPolicies('PreToolUse', tool, empty);
      if (unifiedRes && unifiedRes.stdout) return unifiedRes;
      const scripts = PRETOOL_SCRIPTS[tool] || [];
      // HME primer runs before first HME_* tool each session — always chain it
      // for any HME_-prefixed tool, the primer self-guards against re-fire.
      if (tool.startsWith('HME_') || tool.startsWith('mcp__HME__')) {
        scripts.unshift(path.join(PRETOOLUSE, 'pretooluse_hme_primer.sh'));
      }
      if (scripts.length === 0) return { stdout: '', stderr: '', exit_code: 0 };
      return runChain(scripts, empty);
    }
    case 'PostToolUse': {
      const tool = _toolName(empty);
      // Run unified registry's PostToolUse policies first (currently a
      // small set; will grow as bash trackers migrate). Block decisions
      // short-circuit the bash chain.
      const unifiedRes = await _runUnifiedPolicies('PostToolUse', tool, empty);
      if (unifiedRes && unifiedRes.stdout) return unifiedRes;
      const scripts = [...UNIVERSAL_POSTTOOL, ...(POSTTOOL_SCRIPTS[tool] || [])];
      return runChain(scripts, empty);
    }
    default:
      return {
        stdout: '',
        stderr: `[hook_bridge] unknown event: ${eventName}`,
        exit_code: 0,
      };
  }
}

module.exports = { dispatchEvent, runHook, runChain };
