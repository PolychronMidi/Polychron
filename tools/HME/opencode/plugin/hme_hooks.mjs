import { spawnSync } from 'node:child_process';
import path from 'node:path';

function projectRoot(ctx) {
  if (ctx?.project?.directory) return ctx.project.directory;
  return process.cwd();
}

function entrypoint(root) {
  return path.join(root, 'tools', 'HME', 'event_kernel', 'host_hook_entry.js');
}

function runHme(ctx, event, payload) {
  const root = projectRoot(ctx);
  const child = spawnSync(process.execPath, [entrypoint(root), '--host', 'opencode', '--event', event], {
    input: JSON.stringify({ ...payload, cwd: payload.cwd || root }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: root, OPENCODE_PROJECT_ROOT: root, HME_ADAPTER_NO_NUDGE: '1' },
  });
  if (child.status !== 0) throw new Error(child.stderr || `HME ${event} hook failed`);
  const text = String(child.stdout || '').trim();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_err) { return {}; }
}

export function applyDecision(decision, output) {
  const doc = decision.decision || decision.hookSpecificOutput || decision;
  const behavior = doc.behavior || doc.permissionDecision || doc.decision;
  if (behavior === 'deny') throw new Error(doc.message || doc.permissionDecisionReason || doc.reason || 'Denied by HME');
  if (behavior === 'modify' && doc.patch && output && output.args) Object.assign(output.args, doc.patch.args || doc.patch);
}

export const HmeHooks = async (ctx) => ({
  'tool.execute.before': async (input, output) => {
    const decision = runHme(ctx, 'PreToolUse', { tool_name: input.tool, tool_input: output.args || input.args || {}, session_id: input.sessionID || input.session_id || '' });
    applyDecision(decision, output);
  },
  'tool.execute.after': async (input, output) => {
    runHme(ctx, 'PostToolUse', { tool_name: input.tool, tool_input: input.args || {}, tool_response: output || {}, session_id: input.sessionID || input.session_id || '' });
  },
  'permission.asked': async (input, output) => {
    const decision = runHme(ctx, 'PermissionRequest', { tool_name: input.tool || input.actionName || '', tool_input: input.action || {}, session_id: input.sessionID || input.session_id || '' });
    applyDecision(decision, output);
  },
  'session.created': async (input) => { runHme(ctx, 'SessionStart', input || {}); },
  'session.compacted': async (input) => { runHme(ctx, 'PostCompact', input || {}); },
});
