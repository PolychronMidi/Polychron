import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MAX_RELAY_LOG_BYTES = 1024 * 1024;
const INSTALLED_PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');

function hasHmeEntrypoint(root) {
  return fs.existsSync(entrypoint(root));
}

function projectRoot(ctx) {
  const candidates = [ctx?.project?.directory, process.cwd(), INSTALLED_PROJECT_ROOT].filter(Boolean);
  return candidates.find(hasHmeEntrypoint) || INSTALLED_PROJECT_ROOT;
}

function entrypoint(root) {
  return path.join(root, 'tools', 'HME', 'event_kernel', 'host_hook_entry.js');
}

function nodeBin() {
  return process.env.HME_NODE_BIN || process.env.NODE_BINARY || 'node';
}

function appendRelayLog(root, row) {
  const file = path.join(root, 'tools', 'HME', 'runtime', 'opencode-plugin-relay.jsonl');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_RELAY_LOG_BYTES) {
        fs.rmSync(`${file}.1`, { force: true });
        fs.renameSync(file, `${file}.1`);
      }
    } catch (_err) {
      // Missing/unreadable relay logs are best-effort observability only.
    }
    fs.appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
  } catch (_err) {
    // Plugin relay logging must never affect OpenCode hook behavior.
  }
}

function runHme(ctx, event, payload) {
  const root = projectRoot(ctx);
  const started = Date.now();
  const child = spawnSync(nodeBin(), [entrypoint(root), '--host', 'opencode', '--event', event], {
    input: JSON.stringify({ ...payload, cwd: payload.cwd || root }),
    encoding: 'utf8',
    env: { ...process.env, PROJECT_ROOT: root, OPENCODE_PROJECT_ROOT: root, HME_ADAPTER_NO_NUDGE: '1' },
  });
  appendRelayLog(root, {
    event,
    status: child.status === 0 ? 'ok' : 'error',
    exit_code: child.status == null ? 1 : child.status,
    duration_ms: Date.now() - started,
    stdout_bytes: Buffer.byteLength(child.stdout || ''),
    stderr_bytes: Buffer.byteLength(child.stderr || ''),
    stderr_preview: String(child.stderr || '').slice(0, 500),
  });
  if (child.status !== 0) return {};
  const text = String(child.stdout || '').trim();
  if (!text) return {};
  try { return JSON.parse(text); }
  catch (_err) { return {}; }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function toolName(input) {
  const tool = input?.tool;
  if (typeof tool === 'string') return tool;
  if (isPlainObject(tool)) return String(tool.name || tool.id || tool.type || '');
  return String(input?.tool_name || input?.toolName || input?.actionName || '');
}

function toolArgs(input, output) {
  if (isPlainObject(output?.args)) return output.args;
  if (isPlainObject(input?.args)) return input.args;
  if (isPlainObject(input?.tool?.input)) return input.tool.input;
  if (isPlainObject(input?.action)) return input.action;
  return {};
}

function sessionId(input) {
  return String(input?.sessionID || input?.session_id || input?.session?.id || '');
}

function eventType(input) {
  return String(input?.event?.type || input?.type || input?.event || input?.name || '');
}

function eventPayload(input) {
  return isPlainObject(input?.event) ? input.event : input || {};
}

function relayEvent(ctx, event, payload) {
  runHme(ctx, event, payload || {});
}

function applyDecision(decision, output) {
  const doc = isPlainObject(decision.decision)
    ? decision.decision
    : isPlainObject(decision.hookSpecificOutput)
      ? decision.hookSpecificOutput
      : decision;
  const behavior = doc.behavior || doc.permissionDecision || doc.decision;
  if (behavior === 'deny') throw new Error(doc.message || doc.permissionDecisionReason || doc.reason || 'Denied by HME');
  if (behavior === 'block') throw new Error(doc.message || doc.permissionDecisionReason || doc.reason || 'Blocked by HME');
  const patch = doc.patch?.args || doc.patch;
  if (behavior === 'modify' && isPlainObject(patch) && isPlainObject(output?.args)) Object.assign(output.args, patch);
}

async function HmeHooks(ctx) {
  appendRelayLog(projectRoot(ctx), { event: 'plugin.init', status: 'ok', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
  return {
  event: async (input) => {
    appendRelayLog(projectRoot(ctx), { event: 'event.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    const type = eventType(input);
    const payload = eventPayload(input);
    if (/session\.(created|start|started)/i.test(type)) relayEvent(ctx, 'SessionStart', payload);
    if (/session\.(compacting|compact\.start|compact\.before)/i.test(type)) relayEvent(ctx, 'PreCompact', payload);
    if (/session\.(compacted|compact\.end|compact\.after)/i.test(type)) relayEvent(ctx, 'PostCompact', payload);
    if (/session\.(idle|stopped|stop|ended|finished)/i.test(type)) relayEvent(ctx, 'Stop', payload);
  },
  'chat.message': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'chat.message.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    relayEvent(ctx, 'UserPromptSubmit', { ...input, message: output?.message || {}, parts: output?.parts || [], session_id: sessionId(input) });
  },
  'command.execute.before': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'command.execute.before.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    relayEvent(ctx, 'UserPromptSubmit', { ...input, command: input?.command || '', arguments: input?.arguments || '', parts: output?.parts || [], session_id: sessionId(input) });
  },
  'experimental.session.compacting': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'experimental.session.compacting.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    relayEvent(ctx, 'PreCompact', { ...input, context: output?.context || [], prompt: output?.prompt || '', session_id: sessionId(input) });
  },
  'experimental.compaction.autocontinue': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'experimental.compaction.autocontinue.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    relayEvent(ctx, 'PostCompact', { ...input, enabled: output?.enabled, session_id: sessionId(input) });
  },
  'tool.execute.before': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'tool.execute.before.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    const decision = runHme(ctx, 'PreToolUse', { tool_name: toolName(input), tool_input: toolArgs(input, output), session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  'tool.execute.after': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'tool.execute.after.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    runHme(ctx, 'PostToolUse', { tool_name: toolName(input), tool_input: toolArgs(input, {}), tool_response: output || {}, session_id: sessionId(input) });
  },
  'permission.ask': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'permission.ask.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    const decision = runHme(ctx, 'PermissionRequest', { tool_name: toolName(input), tool_input: toolArgs(input, output), session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  'session.stop': async (input, output) => {
    appendRelayLog(projectRoot(ctx), { event: 'session.stop.callback', status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
    const decision = runHme(ctx, 'Stop', { ...input, session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  };
}

export default async function HmeOpenCodePlugin(ctx) {
  return HmeHooks(ctx);
}
