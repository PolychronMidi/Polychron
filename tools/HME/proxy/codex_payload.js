'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeStructuredBridgeCalls } = require('./codex_tool_text');
const { normalizeICommandsInValue } = require('./i_command_text');
const { injectNativeToolSchemas } = require('./codex_native_tools');
const { stripHookNoiseInValue } = require('./hook_noise_text');

const HOOK_SUCCESS_RE = /^\s*(SessionStart|UserPromptSubmit|PreToolUse|PostToolUse|Notification|Stop|SubagentStop|PreCompact|PostCompact|PermissionRequest) hook \((completed|skipped)\)\s*$/;
const WRAPPER_AUTOCORRECT_RE = /^\s*warning:\s*i\/ wrapper path auto-corrected -- rewritten to absolute path under PROJECT_ROOT\s*$/;
const STOP_REREAD_RE = /^\s*STOP\. Re-read CLAUDE\.md and the user prompt\./;
const EMPTY_TEXT_TYPES = new Set(['input_text', 'output_text', 'text']);

function jsonBytes(value) {
  try { return Buffer.byteLength(JSON.stringify(value)); } catch (_e) { return 0; }
}

function byteLen(value) {
  return Buffer.byteLength(String(value || ''));
}

function bump(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if (typeof tool.name === 'string') return tool.name;
  if (tool.function && typeof tool.function.name === 'string') return tool.function.name;
  if (typeof tool.type === 'string') return tool.type;
  return '';
}

function requestStats(body, previewChars = 0) {
  const instructions = typeof body.instructions === 'string' ? body.instructions : '';
  const tools = Array.isArray(body.tools) ? body.tools : [];
  const roles = {};
  const itemTypes = {};
  const previews = [];
  let textBytes = byteLen(instructions);
  let contentItems = 0;

  function walk(value, trail) {
    if (typeof value === 'string') {
      textBytes += byteLen(value);
      if (previewChars > 0 && previews.length < 12 && value.trim()) {
        previews.push({
          path: trail.slice(-6).join('.'),
          bytes: byteLen(value),
          text: redactPreview(value, previewChars),
        });
      }
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) walk(value[i], trail.concat(String(i)));
      return;
    }
    if (typeof value.role === 'string') bump(roles, value.role);
    if (typeof value.type === 'string') bump(itemTypes, value.type);
    if (Array.isArray(value.content)) contentItems += value.content.length;
    for (const [key, child] of Object.entries(value)) walk(child, trail.concat(key));
  }
  walk(body.input || [], ['input']);
  walk(body.messages || [], ['messages']);

  return {
    model: body.model || '',
    body_bytes: jsonBytes(body),
    instruction_bytes: byteLen(instructions),
    input_count: Array.isArray(body.input) ? body.input.length : 0,
    message_count: Array.isArray(body.messages) ? body.messages.length : 0,
    content_item_count: contentItems,
    text_bytes: textBytes,
    role_counts: roles,
    item_type_counts: itemTypes,
    tool_count: tools.length,
    tool_names: tools.map(toolName).filter(Boolean).slice(0, 120),
    stream: Boolean(body.stream),
    ...(previews.length ? { previews } : {}),
  };
}

function redactPreview(text, maxChars) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .slice(0, maxChars);
}

function disabledToolSet(cfg) {
  const fromConfig = cfg?.request_transform?.disabled_tools;
  const raw = process.env.HME_CODEX_DISABLED_TOOLS || '';
  const names = Array.isArray(fromConfig) ? fromConfig : [];
  return new Set([
    ...names.map((x) => String(x).trim()).filter(Boolean),
    ...raw.split(',').map((x) => x.trim()).filter(Boolean),
  ]);
}

function extraInstructions(cfg, projectRoot, record) {
  const parts = [];
  const inline = process.env.HME_CODEX_EXTRA_INSTRUCTIONS || cfg?.request_transform?.extra_instructions || '';
  if (inline) parts.push(String(inline));
  const file = process.env.HME_CODEX_INSTRUCTION_APPEND_FILE || cfg?.request_transform?.instruction_append_file || '';
  if (file) {
    const abs = path.isAbsolute(file) ? file : path.join(projectRoot, file);
    try { parts.push(fs.readFileSync(abs, 'utf8').trim()); }
    catch (err) { record({ kind: 'config-warning', message: `instruction append file unreadable: ${err.message}` }); }
  }
  return parts.filter(Boolean).join('\n\n');
}

function cleanupOptions(cfg) {
  const cleanup = cfg?.request_transform?.cleanup || cfg?.cleanup || {};
  return {
    enabled: process.env.HME_CODEX_PROXY_CLEANUP === '1' || cleanup.enabled === true,
    stripSuccessHookNoise: cleanup.strip_success_hook_noise !== false,
    dropEmptyTextItems: cleanup.drop_empty_text_items !== false,
  };
}

function payloadLogOptions(cfg) {
  const log = cfg?.request_transform?.payload_log || cfg?.payload_log || {};
  return {
    enabled: process.env.HME_CODEX_PROXY_PAYLOAD_LOG === '1' || log.enabled === true,
    previewChars: Number(process.env.HME_CODEX_PROXY_PREVIEW_CHARS || log.preview_chars || 0),
  };
}

function cleanText(text, opts, stats) {
  if (!opts.stripSuccessHookNoise) return text;
  const lines = String(text).split(/\r?\n/);
  const kept = [];
  let sawStopReread = false;
  for (const line of lines) {
    let category = '';
    if (HOOK_SUCCESS_RE.test(line)) category = 'hook_success_lines';
    else if (WRAPPER_AUTOCORRECT_RE.test(line)) category = 'autocorrect_lines';
    else if (STOP_REREAD_RE.test(line)) {
      if (sawStopReread) category = 'duplicate_stop_blocks';
      sawStopReread = true;
    }
    if (category) {
      stats.removed_lines++;
      stats.removed_bytes += byteLen(line) + 1;
      stats.categories[category] = (stats.categories[category] || 0) + 1;
      continue;
    }
    kept.push(line);
  }
  return kept.join('\n');
}

function isEmptyTextItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!EMPTY_TEXT_TYPES.has(String(value.type || ''))) return false;
  const text = typeof value.text === 'string'
    ? value.text
    : (typeof value.content === 'string' ? value.content : null);
  return text !== null && text.trim() === '';
}

function cleanValue(value, opts, stats, protectedUserText = false) {
  if (typeof value === 'string') return protectedUserText ? value : cleanText(value, opts, stats);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      const cleaned = cleanValue(item, opts, stats, protectedUserText);
      if (opts.dropEmptyTextItems && !protectedUserText && isEmptyTextItem(cleaned)) {
        stats.dropped_empty_text_items++;
        stats.categories.empty_text_items++;
        continue;
      }
      next.push(cleaned);
    }
    return next;
  }
  const childProtected = protectedUserText || value.role === 'user';
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = cleanValue(child, opts, stats, childProtected);
  return out;
}

function cleanPayload(body, cfg) {
  const opts = cleanupOptions(cfg);
  const stats = {
    enabled: opts.enabled,
    removed_lines: 0,
    removed_bytes: 0,
    dropped_empty_text_items: 0,
    categories: {
      hook_success_lines: 0,
      autocorrect_lines: 0,
      duplicate_stop_blocks: 0,
      empty_text_items: 0,
    },
  };
  if (!opts.enabled) return { body, cleanup: stats };
  return { body: cleanValue(body, opts, stats, false), cleanup: stats };
}

function applyRequestTransform(body, deps) {
  const cfg = deps.loadConfig();
  const record = deps.record || (() => {});
  const projectRoot = deps.projectRoot || process.cwd();
  const before = requestStats(body);
  const disabled = disabledToolSet(cfg);
  let transformed = { ...body };
  if (disabled.size && Array.isArray(body.tools)) {
    transformed.tools = body.tools.filter((tool) => !disabled.has(toolName(tool)));
  }
  const extra = extraInstructions(cfg, projectRoot, record);
  if (extra) {
    transformed.instructions = `${typeof body.instructions === 'string' ? body.instructions : ''}\n\n${extra}`;
  }
  const nativeTools = injectNativeToolSchemas(transformed, cfg);
  transformed = nativeTools.body;
  const iCommandStats = { command_rewrites: 0, text_rewrites: 0 };
  transformed = normalizeICommandsInValue(transformed, iCommandStats);
  const bridgeNormalized = normalizeStructuredBridgeCalls(transformed);
  transformed = bridgeNormalized.body;
  const hookNoiseStats = {};
  transformed = stripHookNoiseInValue(transformed, hookNoiseStats);
  const cleaned = cleanPayload(transformed, cfg);
  transformed = cleaned.body;
  const after = requestStats(transformed);
  const warnInstructionBytes = Number(cfg?.request_transform?.max_instruction_bytes_warn || 0);
  const warnToolCount = Number(cfg?.request_transform?.max_tool_count_warn || 0);
  if ((warnInstructionBytes && after.instruction_bytes > warnInstructionBytes)
      || (warnToolCount && after.tool_count > warnToolCount)) {
    record({
      kind: 'bloat-warning',
      instruction_bytes: after.instruction_bytes,
      tool_count: after.tool_count,
      max_instruction_bytes_warn: warnInstructionBytes,
      max_tool_count_warn: warnToolCount,
    });
  }
  const logOpts = payloadLogOptions(cfg);
  return {
    body: transformed,
    before,
    after,
    cleanup: { ...cleaned.cleanup, bridge_calls: bridgeNormalized.stats.call_rewrites, bridge_text: bridgeNormalized.stats.text_rewrites, native_tools_added: nativeTools.stats.added, hook_noise_lines: hookNoiseStats.stripped || 0, i_commands: iCommandStats.command_rewrites, i_text: iCommandStats.text_rewrites },
    payload_log: logOpts.enabled ? {
      target: 'codex-responses-log-only',
      before: requestStats(body, logOpts.previewChars),
      after: requestStats(transformed, logOpts.previewChars),
    } : null,
  };
}

module.exports = {
  applyRequestTransform,
  requestStats,
  toolName,
};
