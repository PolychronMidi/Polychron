import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const shortcutsRewriter = require('../../proxy/middleware/00a_shortcuts_rewriter.js');
const { loadEnv, requireEnvBool } = require('../../proxy/shared/load_env.js');
const MAX_RELAY_LOG_BYTES = 1024 * 1024;
const INSTALLED_PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const HOOK_TOAST_COOLDOWN_MS = 2000;
const lastHookToastAt = new Map();
const templatePromptCache = new Map();
const OPENCODE_ERROR_ROUTING_STATE = globalThis.__HME_OPENCODE_ERROR_ROUTING_STATE || (globalThis.__HME_OPENCODE_ERROR_ROUTING_STATE = {
  roots: new Set(),
  installed: false,
  originalStderrWrite: null,
});

function errorLineLooksActionable(text) {
  return /\b(error|exception|typeerror|validation|schema|invalid|zod|panic|failed|failure)\b/i.test(String(text || ''));
}

function appendHmeError(root, tag, message, meta = {}) {
  try {
    const file = path.join(root, 'log', 'hme-errors.log');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const clean = String(message || '').replace(/\s+/g, ' ').trim().slice(0, 2000);
    const metaText = Object.keys(meta).length ? ` ${JSON.stringify(meta).slice(0, 1000)}` : '';
    fs.appendFileSync(file, `[${tag}] ERROR ${clean}${metaText}\n`);
  } catch (_err) {
    // Error routing must never create a secondary OpenCode failure.
  }
}

function installOpenCodeErrorRouting(root) {
  OPENCODE_ERROR_ROUTING_STATE.roots.add(root);
  if (OPENCODE_ERROR_ROUTING_STATE.installed) return;
  OPENCODE_ERROR_ROUTING_STATE.installed = true;

  process.on('uncaughtException', (err) => {
    for (const r of OPENCODE_ERROR_ROUTING_STATE.roots) appendHmeError(r, 'opencode-uncaught', err && err.stack ? err.stack : String(err));
  });
  process.on('unhandledRejection', (err) => {
    for (const r of OPENCODE_ERROR_ROUTING_STATE.roots) appendHmeError(r, 'opencode-unhandled-rejection', err && err.stack ? err.stack : String(err));
  });

  OPENCODE_ERROR_ROUTING_STATE.originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function hmeOpenCodeStderrMirror(chunk, encoding, cb) {
    const result = OPENCODE_ERROR_ROUTING_STATE.originalStderrWrite(chunk, encoding, cb);
    try {
      const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '');
      if (errorLineLooksActionable(text)) {
        for (const r of OPENCODE_ERROR_ROUTING_STATE.roots) appendHmeError(r, 'opencode-stderr', text);
      }
    } catch (_err) {
      // Mirror best-effort only.
    }
    return result;
  };
}

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

function expectedHmeBlock(message) {
  const err = new Error(message);
  err.hmeExpectedBlock = true;
  return err;
}

function visibleHookToastsEnabled(root) {
  if (process.env.HME_OPENCODE_HOOK_TOASTS === undefined || process.env.HME_OPENCODE_HOOK_TOASTS === '') {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) return false;
    loadEnv(envPath);
  }
  return requireEnvBool('HME_OPENCODE_HOOK_TOASTS');
}

function systemReplacementEnabled(root) {
  if (process.env.HME_REPLACE_SYSTEM_PROMPT === undefined || process.env.HME_REPLACE_SYSTEM_PROMPT === '') {
    const envPath = path.join(root, '.env');
    if (!fs.existsSync(envPath)) return false;
    loadEnv(envPath);
  }
  return requireEnvBool('HME_REPLACE_SYSTEM_PROMPT');
}

function loadTemplatePrompt(root, name) {
  const file = path.join(root, 'doc', 'templates', name);
  const cached = templatePromptCache.get(file);
  try {
    const stat = fs.statSync(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.content;
    const content = fs.readFileSync(file, 'utf8').trimEnd();
    const entry = { mtimeMs: stat.mtimeMs, content: content.trim() ? content : null };
    templatePromptCache.set(file, entry);
    return entry.content;
  } catch (_err) {
    templatePromptCache.set(file, { mtimeMs: 0, content: null });
    return null;
  }
}

function composedSystemPrompt(root) {
  const canonical = loadTemplatePrompt(root, 'canonical-system-prompt.md');
  if (canonical === null) return null;
  const agents = loadTemplatePrompt(root, 'AGENTS.md');
  if (agents === null) return canonical;
  return `${canonical}\n\n<doc_templates_agents_md>\n${agents}\n</doc_templates_agents_md>`;
}

function replaceSystemPrompt(ctx, output) {
  if (!Array.isArray(output?.system)) return false;
  const root = projectRoot(ctx);
  if (!systemReplacementEnabled(root)) return false;
  const canonical = composedSystemPrompt(root);
  if (canonical === null) return false;
  output.system.length = 0;
  output.system.push(canonical);
  appendRelayLog(root, { event: 'system_prompt_replaced', status: 'ok', exit_code: 0, duration_ms: 0, stdout_bytes: Buffer.byteLength(canonical), stderr_bytes: 0 });
  return true;
}

async function markHookEntered(ctx, event) {
  const root = projectRoot(ctx);
  if (event !== 'event.callback') appendRelayLog(root, { event, status: 'entered', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
  if (!visibleHookToastsEnabled(root)) return;
  if (event === 'event.callback') return;
  const now = Date.now();
  if (now - (lastHookToastAt.get(event) || 0) < HOOK_TOAST_COOLDOWN_MS) return;
  lastHookToastAt.set(event, now);
  try {
    await ctx?.client?.tui?.showToast?.({
      body: {
        title: 'HME hook',
        message: event,
        variant: 'info',
        duration: 1500,
      },
    });
  } catch (_err) {
    // UI visibility is diagnostic only; hook behavior must remain governed by HME.
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

function hmeToolName(input) {
  const name = toolName(input);
  if (name === 'write') return 'Write';
  if (name === 'edit' || name === 'apply_patch') return 'Edit';
  return name;
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

function relayMutableEvent(ctx, event, input, output) {
  return runHme(ctx, event, { ...input, ...output, session_id: sessionId(input) });
}

function rewritePromptShortcuts(ctx, output) {
  if (!Array.isArray(output?.parts)) return;
  const payload = { messages: [{ role: 'user', content: output.parts }] };
  let dirty = false;
  shortcutsRewriter.onRequest({
    payload,
    ctx: {
      markDirty: () => { dirty = true; },
      emit: (row) => appendRelayLog(projectRoot(ctx), { event: row.event || 'shortcut_expanded', status: 'ok', ...row }),
    },
  });
  if (dirty && output.message && typeof output.message === 'object') output.message._hme_shortcut_expanded = true;
}

function applyDecision(decision, output) {
  const doc = isPlainObject(decision.decision)
    ? decision.decision
    : isPlainObject(decision.hookSpecificOutput)
      ? decision.hookSpecificOutput
      : decision;
  const behavior = doc.behavior || doc.permissionDecision || doc.decision;
  if (behavior === 'deny') throw expectedHmeBlock(doc.message || doc.permissionDecisionReason || doc.reason || 'Denied by HME');
  if (behavior === 'block') throw expectedHmeBlock(doc.message || doc.permissionDecisionReason || doc.reason || 'Blocked by HME');
  const patch = doc.updatedInput || doc.patch?.args || doc.patch;
  if (behavior === 'modify' && isPlainObject(patch) && isPlainObject(output?.args)) Object.assign(output.args, patch);
  if (isPlainObject(doc.updatedInput) && isPlainObject(output?.args)) Object.assign(output.args, doc.updatedInput);
  if (doc.text !== undefined && output && Object.prototype.hasOwnProperty.call(output, 'text')) output.text = String(doc.text || '');
  if ((doc.kind === 'drop' || doc.decision === 'drop') && output && Object.prototype.hasOwnProperty.call(output, 'text')) output.text = '';
}

function wrapHookErrors(ctx, hooks) {
  const root = projectRoot(ctx);
  const wrapped = {};
  for (const [name, fn] of Object.entries(hooks)) {
    wrapped[name] = async (...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        if (!err?.hmeExpectedBlock) {
          appendHmeError(root, 'opencode-plugin', err && err.stack ? err.stack : String(err), { hook: name });
        }
        throw err;
      }
    };
  }
  return wrapped;
}

async function HmeHooks(ctx) {
  installOpenCodeErrorRouting(projectRoot(ctx));
  appendRelayLog(projectRoot(ctx), { event: 'plugin.init', status: 'ok', exit_code: 0, duration_ms: 0, stdout_bytes: 0, stderr_bytes: 0 });
  return wrapHookErrors(ctx, {
  event: async (input) => {
    await markHookEntered(ctx, 'event.callback');
    const type = eventType(input);
    const payload = eventPayload(input);
    if (/session\.(created|start|started)/i.test(type)) relayEvent(ctx, 'SessionStart', payload);
    if (/session\.(compacting|compact\.start|compact\.before)/i.test(type)) relayEvent(ctx, 'PreCompact', payload);
    if (/session\.(compacted|compact\.end|compact\.after)/i.test(type)) relayEvent(ctx, 'PostCompact', payload);
    if (/session\.(idle|stopped|stop|ended|finished)/i.test(type)) relayEvent(ctx, 'Stop', payload);
  },
  'chat.message': async (input, output) => {
    await markHookEntered(ctx, 'chat.message.callback');
    rewritePromptShortcuts(ctx, output);
    relayEvent(ctx, 'UserPromptSubmit', { ...input, message: output?.message || {}, parts: output?.parts || [], session_id: sessionId(input) });
  },
  'command.execute.before': async (input, output) => {
    await markHookEntered(ctx, 'command.execute.before.callback');
    relayEvent(ctx, 'UserPromptSubmit', { ...input, command: input?.command || '', arguments: input?.arguments || '', parts: output?.parts || [], session_id: sessionId(input) });
  },
  'chat.params': async (input, output) => {
    await markHookEntered(ctx, 'chat.params.callback');
    applyDecision(relayMutableEvent(ctx, 'ChatParams', input, output), output);
  },
  'chat.headers': async (input, output) => {
    await markHookEntered(ctx, 'chat.headers.callback');
    applyDecision(relayMutableEvent(ctx, 'ChatHeaders', input, output), output);
  },
  'experimental.chat.messages.transform': async (input, output) => {
    await markHookEntered(ctx, 'experimental.chat.messages.transform.callback');
    applyDecision(relayMutableEvent(ctx, 'ChatMessagesTransform', input, output), output);
  },
  'experimental.chat.system.transform': async (input, output) => {
    await markHookEntered(ctx, 'experimental.chat.system.transform.callback');
    replaceSystemPrompt(ctx, output);
    applyDecision(relayMutableEvent(ctx, 'ChatSystemTransform', input, output), output);
  },
  'experimental.session.compacting': async (input, output) => {
    await markHookEntered(ctx, 'experimental.session.compacting.callback');
    relayEvent(ctx, 'PreCompact', { ...input, context: output?.context || [], prompt: output?.prompt || '', session_id: sessionId(input) });
  },
  'experimental.compaction.autocontinue': async (input, output) => {
    await markHookEntered(ctx, 'experimental.compaction.autocontinue.callback');
    relayEvent(ctx, 'PostCompact', { ...input, enabled: output?.enabled, session_id: sessionId(input) });
  },
  'tool.execute.before': async (input, output) => {
    await markHookEntered(ctx, 'tool.execute.before.callback');
    const decision = runHme(ctx, 'PreToolUse', { tool_name: hmeToolName(input), tool_input: toolArgs(input, output), session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  'tool.execute.after': async (input, output) => {
    await markHookEntered(ctx, 'tool.execute.after.callback');
    runHme(ctx, 'PostToolUse', { tool_name: hmeToolName(input), tool_input: toolArgs(input, {}), tool_response: output || {}, session_id: sessionId(input) });
  },
  'permission.ask': async (input, output) => {
    await markHookEntered(ctx, 'permission.ask.callback');
    const decision = runHme(ctx, 'PermissionRequest', { tool_name: toolName(input), tool_input: toolArgs(input, output), session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  'shell.env': async (input, output) => {
    await markHookEntered(ctx, 'shell.env.callback');
    applyDecision(relayMutableEvent(ctx, 'ShellEnv', input, output), output);
  },
  'experimental.text.complete': async (input, output) => {
    await markHookEntered(ctx, 'experimental.text.complete.callback');
    applyDecision(relayMutableEvent(ctx, 'TextComplete', input, output), output);
  },
  'session.stop': async (input, output) => {
    await markHookEntered(ctx, 'session.stop.callback');
    const decision = runHme(ctx, 'Stop', { ...input, session_id: sessionId(input) });
    applyDecision(decision, output);
  },
  });
}

export default async function HmeOpenCodePlugin(ctx) {
  return HmeHooks(ctx);
}
