'use strict';
// Shared Edit/MultiEdit input validation + Edit->Read fallback synthesis.
// Used by both the Claude SSE rewriter (sse_rewriters.js) and the codex
// response rewriter (codex_native_tools.js) so Edit-without-required-fields,
// no-op Edit, display-redacted Edit, and stale-old_string Edit all fall
// back to Read on both routes.

const fs = require('fs');

const EDIT_FALLBACK_DEFAULT_LIMIT = 50;
const EDIT_FALLBACK_MAX_LIMIT = 500;
const _DISPLAY_REDACTED_MARK = '<' + 'display-redacted' + '>';

function editToReadFallback(editInput) {
  const ti = editInput && typeof editInput === 'object' ? editInput : {};
  const file = String(ti.file_path || ti.path || '').trim();
  const out = { file_path: file };
  const offsetRaw = Number(ti.offset || ti.line || ti.start_line || 0);
  const limitRaw = Number(ti.limit || ti.lines || 0);
  let limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, EDIT_FALLBACK_MAX_LIMIT) : EDIT_FALLBACK_DEFAULT_LIMIT;
  if (Number.isFinite(offsetRaw) && offsetRaw > 1) out.offset = Math.floor(offsetRaw);
  if (Number.isFinite(Number(ti.end_line)) && Number(ti.end_line) > 0 && out.offset) {
    const span = Math.floor(Number(ti.end_line)) - out.offset + 1;
    if (span > 0) limit = Math.min(span, EDIT_FALLBACK_MAX_LIMIT);
  }
  out.limit = limit;
  return out;
}

function editIsStale(input) {
  if (!input || typeof input !== 'object') return false;
  const fp = String(input.file_path || input.path || '').trim();
  const old = input.old_string;
  if (!fp || typeof old !== 'string' || old.length === 0) return false;
  if (!fp.startsWith('/')) return false;
  let text;
  try {
    if (!fs.existsSync(fp) || !fs.statSync(fp).isFile()) return false;
    text = fs.readFileSync(fp, 'utf8');
  } catch (_e) { return false; }
  return !text.includes(old);
}

function isInvalidEditInput(input, options = {}) {
  if (!input || typeof input !== 'object') return true;
  if (Array.isArray(input.edits)) {
    if (input.edits.length === 0) return true;
    for (const edit of input.edits) {
      if (!edit || typeof edit !== 'object') return true;
      if (typeof edit.old_string !== 'string' || edit.old_string.length === 0) return true;
      if (typeof edit.new_string !== 'string') return true;
      if (edit.old_string === edit.new_string) return true;
      if (edit.old_string.includes(_DISPLAY_REDACTED_MARK)) return true;
    }
    if (options.checkFs && editIsStale({ ...input, old_string: input.edits[0] && input.edits[0].old_string })) return true;
    return false;
  }
  if (typeof input.old_string !== 'string' || input.old_string.length === 0) return true;
  if (typeof input.new_string !== 'string') return true;
  if (input.old_string === input.new_string) return true;
  if (input.old_string.includes(_DISPLAY_REDACTED_MARK)) return true;
  if (options.checkFs && editIsStale(input)) return true;
  return false;
}

module.exports = { editToReadFallback, editIsStale, isInvalidEditInput, EDIT_FALLBACK_DEFAULT_LIMIT, EDIT_FALLBACK_MAX_LIMIT };
