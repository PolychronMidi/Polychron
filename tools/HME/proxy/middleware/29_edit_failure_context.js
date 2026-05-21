'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');
const { recordFailure } = require('../turn_failure_state');
const sessionState = require('../session_state');
const { isEditFamilyTool } = require('../edit_validation');
const READ_GATE_RE = new RegExp(['File has not been read yet\\.', 'Read it first before writing to it'].join('\\s*'));
const MODIFIED_SINCE_READ_RE = /File has been modified since read[^\n]*/;
const FAIL_RE = /\b(old_string not found|old_string is not unique)\b|File has been modified since read[^\n]*|File has not been read yet\.[^\n]*/;

function textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

function relPath(file, root) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith('..') ? rel : file;
}

function removeTurnEdit(root, file) {
  const base = path.basename(String(file || '')).replace(/\.[^.]*$/, '');
  if (!base) return;
  const state = path.join(root, 'tmp', 'hme-turn-edits.txt');
  try {
    const kept = fs.readFileSync(state, 'utf8').split(/\r?\n/).filter((line) => line && line !== base);
    if (kept.length) fs.writeFileSync(state, `${kept.join('\n')}\n`);
    else fs.rmSync(state, { force: true });
  } catch (_err) { /* no state yet */ }
}

function contextWindow(root, file, oldString = '', newString = '', reason = 'edit failed') {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return { text: `\n[READ current context unavailable: ${relPath(file, root)} is not a readable file]`, readable: false };
  }
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const anchors = [...String(oldString).split(/\r?\n/), ...String(newString).split(/\r?\n/)]
    .map((s) => s.trim()).filter((s) => s.length >= 6);
  let hit = 0;
  for (const anchor of anchors) {
    const idx = lines.findIndex((line) => line.includes(anchor));
    if (idx >= 0) { hit = idx; break; }
  }
  const start = Math.max(0, hit - 20);
  const end = Math.min(lines.length, hit + 21);
  const body = lines.slice(start, end).map((line, i) => `${String(start + i + 1).padStart(5, ' ')} ${line}`).join('\n');
  return { text: `\n[READ current context ${relPath(file, root)}:${start + 1}-${end}]\n${body}`, readable: true };
}

function actualReadResult(root, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return `[READ unavailable: ${relPath(file, root)} is not a readable file]`;
  }
  return fs.readFileSync(file, 'utf8');
}

function _replaceRawReadGateResults(payload, root, ctx) {
  if (!payload || !Array.isArray(payload.messages)) return;
  const toolUseById = new Map();
  for (const msg of payload.messages) {
    if (!msg || !Array.isArray(msg.content)) continue;
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block && block.type === 'tool_use' && block.id && isEditFamilyTool(block.name)) toolUseById.set(block.id, block);
      }
      continue;
    }
    if (msg.role !== 'user') continue;
    for (const block of msg.content) {
      if (!block || block.type !== 'tool_result' || !block.tool_use_id) continue;
      const toolUse = toolUseById.get(block.tool_use_id);
      if (!toolUse) continue;
      const file = (toolUse.input || {}).file_path || (toolUse.input || {}).path || '';
      if (!file) continue;
      const text = textOf(block);
      if (!READ_GATE_RE.test(text) && !MODIFIED_SINCE_READ_RE.test(text)) continue;
      block.content = actualReadResult(root, file);
      block.is_error = false;
      if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'edit_failure_raw_result_replaced', tool: toolUse.name, file: relPath(file, root) });
      if (ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
    }
  }
}

module.exports = {
  name: 'edit_failure_context',
  onRequest({ payload, ctx }) {
    _replaceRawReadGateResults(payload, (ctx && ctx.PROJECT_ROOT) || PROJECT_ROOT, ctx);
  },
  onToolResult({ toolUse, toolResult, session, ctx }) {
    if (!toolUse || !isEditFamilyTool(toolUse.name)) return;
    const input = toolUse.input || {};
    const file = input.file_path || input.path || '';
    if (!file) return;
    const text = textOf(toolResult);
    const failed = toolResult.is_error === true || FAIL_RE.test(text);
    if (!failed) return;
    const root = ctx.PROJECT_ROOT || PROJECT_ROOT;
    const reason = (text.match(FAIL_RE) || [])[0] || 'edit failed';
    removeTurnEdit(root, file);
    recordFailure(root, { tool: toolUse.name, reason, file });
    if (text.includes('[READ current context')) return;
    try {
      const currentContext = contextWindow(root, file, input.old_string || '', input.new_string || '', reason);
      const readEquivalent = currentContext.readable && /File has not been read yet\. Read it first before writing to it|File has been modified since read/.test(text);
      if (readEquivalent && typeof ctx.replaceResult === 'function') {
        ctx.replaceResult(toolResult, actualReadResult(root, file));
      } else {
        ctx.appendToResult(toolResult, currentContext.text);
      }
      if (readEquivalent) {
        sessionState.recordRead({ session_id: session || ctx.session || ctx.session_id || '', tool_name: 'Read', tool_input: { file_path: file } }, { source: 'edit_failure_auto_context' });
      }
      ctx.markDirty();
      ctx.emit({ event: 'edit_failure_context_appended', tool: toolUse.name, file: relPath(file, root), reason, read_equivalent: currentContext.readable, replaced_native_error: readEquivalent });
    } catch (err) {
      ctx.warn(`edit failure context unavailable: ${err.message}`);
    }
  },
};
