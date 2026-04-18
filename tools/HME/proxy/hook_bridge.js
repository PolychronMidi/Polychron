'use strict';
/**
 * Hook bridge: invokes the lifecycle bash hooks (sessionstart, userpromptsubmit,
 * stop) from the proxy's natural attach points. The hooks live in
 * tools/HME/hooks/lifecycle/ and worked historically via Claude Code's plugin
 * system — that path is dead now (plugin cache missing, architecture moved
 * to proxy-middleware-dominant). Rather than rewrite every hook as middleware,
 * this bridge just shells out to them with reconstructed stdin.
 *
 * Responsibilities:
 *   runSessionStart()            — once at proxy startup
 *   runUserPromptSubmit(prompt)  — per new user-turn Anthropic request
 *   runStop(sessionId)           — per Anthropic response end
 *
 * All are fire-and-forget w.r.t. the proxy's response path — we spawn detached
 * processes so the proxy never blocks on git/filesystem work inside a hook.
 * Hook stderr surfaces into `log/hme-proxy.out` via the parent's stderr pipe,
 * which is where the user already watches for proxy-level banners.
 *
 * Deduplication: `runUserPromptSubmit` tracks the last-fired prompt hash so a
 * retried or replayed request doesn't double-fire. `runStop` has no dedupe —
 * auto-commit is idempotent (nothing-to-commit is a no-op) and the hook can
 * safely fire on every upstream response end including tool-loop continuations.
 */

const { spawn } = require('child_process');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const HOOKS_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'hooks', 'lifecycle');
const USERPROMPTSUBMIT = path.join(HOOKS_DIR, 'userpromptsubmit.sh');
const STOP = path.join(HOOKS_DIR, 'stop.sh');
const SESSIONSTART = path.join(HOOKS_DIR, 'sessionstart.sh');

// Simple dedupe: track hash of the last-fired user_prompt so retried or
// replayed requests don't double-commit at the userpromptsubmit boundary.
let _lastUserPromptHash = null;

function _hash(s) {
  let h = 0;
  const n = Math.min(s.length, 1000);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function _invokeHook(scriptPath, stdinJson, label) {
  try {
    const child = spawn('bash', [scriptPath], {
      detached: true,
      stdio: ['pipe', 'ignore', 'inherit'],
      env: { ...process.env, PROJECT_ROOT },
    });
    child.on('error', (err) => {
      console.error(`[hook_bridge] ${label} spawn error: ${err.message}`);
    });
    child.stdin.write(stdinJson);
    child.stdin.end();
    child.unref();
  } catch (err) {
    console.error(`[hook_bridge] ${label} failed: ${err.message}`);
  }
}

function runSessionStart() {
  _invokeHook(SESSIONSTART, '{}', 'sessionstart');
}

function runUserPromptSubmit(userPrompt, sessionId) {
  if (typeof userPrompt !== 'string' || userPrompt.length === 0) return false;
  const h = _hash(userPrompt);
  if (h === _lastUserPromptHash) return false;
  _lastUserPromptHash = h;
  const payload = JSON.stringify({
    user_prompt: userPrompt,
    session_id: sessionId || 'unknown',
  });
  _invokeHook(USERPROMPTSUBMIT, payload, 'userpromptsubmit');
  return true;
}

function runStop(sessionId) {
  const payload = JSON.stringify({
    session_id: sessionId || 'unknown',
    transcript_path: '',
  });
  _invokeHook(STOP, payload, 'stop');
}

/**
 * Pull the user's current prompt out of an Anthropic request payload.
 * Returns the prompt text if the last message is a user turn with text
 * content. Returns null for tool-result continuations (so auto-commit fires
 * at turn boundaries, not tool loops).
 */
function extractUserPrompt(payload) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return null;
  const last = payload.messages[payload.messages.length - 1];
  if (!last || last.role !== 'user') return null;
  const content = last.content;
  if (typeof content === 'string') return content.length > 0 ? content : null;
  if (Array.isArray(content)) {
    const textBlocks = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string');
    if (textBlocks.length === 0) return null;  // tool_result-only = continuation
    return textBlocks.map((b) => b.text).join('\n');
  }
  return null;
}

module.exports = { runSessionStart, runUserPromptSubmit, runStop, extractUserPrompt };
