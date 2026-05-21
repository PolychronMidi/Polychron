'use strict';

const fs = require('fs');
const path = require('path');
const { normalizeStructuredBridgeCalls } = require('./codex_tool_text');
const { normalizeICommandsInValue } = require('./i_command_text');
const { stripHookNoiseInValue } = require('./hook_noise_text');
const { stripHookUiEchoInValue } = require('./hook_ui_echo_guard');
const { stripCodexSystemNoise } = require('./codex_system_noise');
const { sanitizeMessages } = require('./conversation_graph');

const EMPTY_TEXT_TYPES = new Set(['input_text', 'output_text', 'text']);

function jsonBytes(value) { try { return Buffer.byteLength(JSON.stringify(value)); } catch (err) { return 0; } }
function byteLen(value) { return Buffer.byteLength(String(value || '')); }
function bump(map, key) { if (key) map[key] = (map[key] || 0) + 1; }

function toolName(tool) {
  if (!tool || typeof tool !== 'object') return '';
  if (typeof tool.name === 'string') return tool.name;
  if (tool.function && typeof tool.function.name === 'string') return tool.function.name;
  if (typeof tool.type === 'string') return tool.type;
  return '';
}

function redactPreview(text, maxChars) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_KEY]')
    .slice(0, maxChars);
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
      if (previewChars > 0 && previews.length < 12 && value.trim()) previews.push({ path: trail.slice(-6).join('.'), bytes: byteLen(value), text: redactPreview(value, previewChars) });
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (let i = 0; i < value.length; i++) walk(value[i], trail.concat(String(i))); return; }
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

function disabledToolSet(cfg) {
  const fromConfig = cfg?.request_transform?.disabled_tools;
  const raw = process.env.HME_CODEX_DISABLED_TOOLS || '';
  const names = Array.isArray(fromConfig) ? fromConfig : [];
  return new Set([...names.map((x) => String(x).trim()).filter(Boolean), ...raw.split(',').map((x) => x.trim()).filter(Boolean)]);
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
  return { enabled: process.env.HME_CODEX_PROXY_CLEANUP === '1' || cleanup.enabled === true, dropEmptyTextItems: cleanup.drop_empty_text_items !== false };
}

function payloadLogOptions(cfg) {
  const log = cfg?.request_transform?.payload_log || cfg?.payload_log || {};
  return { enabled: process.env.HME_CODEX_PROXY_PAYLOAD_LOG === '1' || log.enabled === true, previewChars: Number(process.env.HME_CODEX_PROXY_PREVIEW_CHARS || log.preview_chars || 0) };
}

function isEmptyTextItem(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!EMPTY_TEXT_TYPES.has(String(value.type || ''))) return false;
  const text = typeof value.text === 'string' ? value.text : (typeof value.content === 'string' ? value.content : null);
  return text !== null && text.trim() === '';
}

function cleanValue(value, opts, stats, protectedUserText = false) {
  if (typeof value === 'string' || !value || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const next = [];
    for (const item of value) {
      const cleaned = cleanValue(item, opts, stats, protectedUserText);
      if (opts.dropEmptyTextItems && !protectedUserText && isEmptyTextItem(cleaned)) { stats.dropped_empty_text_items++; stats.categories.empty_text_items++; continue; }
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
  const stats = { enabled: opts.enabled, removed_lines: 0, removed_bytes: 0, dropped_empty_text_items: 0, categories: { hook_success_lines: 0, autocorrect_lines: 0, duplicate_stop_blocks: 0, empty_text_items: 0 } };
  if (!opts.enabled) return { body, cleanup: stats };
  return { body: cleanValue(body, opts, stats, false), cleanup: stats };
}

function mergeHookNoiseStats(cleanup, hookNoiseStats) {
  cleanup.removed_lines += hookNoiseStats.stripped || 0;
  cleanup.removed_bytes += hookNoiseStats.removed_bytes || 0;
  for (const [k, v] of Object.entries(hookNoiseStats.categories || {})) cleanup.categories[k] = (cleanup.categories[k] || 0) + v;
  return cleanup;
}

function applyCodexRequestTransform(body, deps, injectNativeToolSchemas) {
  const cfg = deps.loadConfig();
  const record = deps.record || (() => {});
  const projectRoot = deps.projectRoot || process.cwd();
  const before = requestStats(body);
  const disabled = disabledToolSet(cfg);
  let transformed = { ...body };
  if (disabled.size && Array.isArray(body.tools)) transformed.tools = body.tools.filter((tool) => !disabled.has(toolName(tool)));
  const extra = extraInstructions(cfg, projectRoot, record);
  if (extra) transformed.instructions = `${typeof body.instructions === 'string' ? body.instructions : ''}\n\n${extra}`;
  const nativeTools = injectNativeToolSchemas ? injectNativeToolSchemas(transformed, cfg) : { body: transformed, stats: { added: 0 } };
  transformed = nativeTools.body;
  const iCommandStats = { command_rewrites: 0, text_rewrites: 0 };
  transformed = normalizeICommandsInValue(transformed, iCommandStats);
  const bridgeNormalized = normalizeStructuredBridgeCalls(transformed);
  transformed = bridgeNormalized.body;
  const hookNoiseStats = {};
  transformed = stripHookUiEchoInValue(transformed, hookNoiseStats, { projectRoot, source: 'request' });
  transformed = stripHookNoiseInValue(transformed, hookNoiseStats);
  const systemNoiseStats = {};
  transformed = stripCodexSystemNoise(transformed, systemNoiseStats);
  const cleaned = cleanPayload(transformed, cfg);
  transformed = cleaned.body;
  const after = requestStats(transformed);
  const cleanup = mergeHookNoiseStats({ ...cleaned.cleanup }, hookNoiseStats);
  const warnInstructionBytes = Number(cfg?.request_transform?.max_instruction_bytes_warn || 0);
  const warnToolCount = Number(cfg?.request_transform?.max_tool_count_warn || 0);
  if ((warnInstructionBytes && after.instruction_bytes > warnInstructionBytes) || (warnToolCount && after.tool_count > warnToolCount)) record({ kind: 'bloat-warning', instruction_bytes: after.instruction_bytes, tool_count: after.tool_count, max_instruction_bytes_warn: warnInstructionBytes, max_tool_count_warn: warnToolCount });
  const logOpts = payloadLogOptions(cfg);
  return {
    body: transformed,
    before,
    after,
    cleanup: { ...cleanup, bridge_calls: bridgeNormalized.stats.call_rewrites, bridge_text: bridgeNormalized.stats.text_rewrites, native_tools_added: nativeTools.stats.added, hook_noise_lines: hookNoiseStats.stripped || 0, i_commands: iCommandStats.command_rewrites, i_text: iCommandStats.text_rewrites, codex_system_noise: systemNoiseStats.dropped || 0, codex_system_noise_bytes: systemNoiseStats.removed_bytes || 0, codex_system_noise_categories: systemNoiseStats.categories || {} },
    payload_log: logOpts.enabled ? { target: 'codex-responses-log-only', before: requestStats(body, logOpts.previewChars), after: requestStats(transformed, logOpts.previewChars) } : null,
  };
}

function applyAnthropicCommonTransforms(payload) {
  const iStats = { command_rewrites: 0, text_rewrites: 0 };
  const normalized = normalizeICommandsInValue(payload, iStats);
  if (normalized && normalized !== payload) { for (const k of Object.keys(payload)) delete payload[k]; Object.assign(payload, normalized); }
  const hookNoiseStats = {};
  const uiStripped = stripHookUiEchoInValue(payload, hookNoiseStats, { projectRoot: require('./shared').PROJECT_ROOT, source: 'request' });
  if (uiStripped && uiStripped !== payload) { for (const k of Object.keys(payload)) delete payload[k]; Object.assign(payload, uiStripped); }
  const stripped = stripHookNoiseInValue(payload, hookNoiseStats);
  if (stripped && stripped !== payload) { for (const k of Object.keys(payload)) delete payload[k]; Object.assign(payload, stripped); }
  const sanitized = sanitizeMessages(payload);
  return { changed: iStats.command_rewrites + iStats.text_rewrites + (hookNoiseStats.stripped || 0) + sanitized, i: iStats, hook_noise: hookNoiseStats, sanitized };
}

module.exports = { requestStats, toolName, cleanPayload, applyCodexRequestTransform, applyAnthropicCommonTransforms };
