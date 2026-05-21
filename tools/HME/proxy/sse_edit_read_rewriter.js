'use strict';

function _holdToolInput(ctx, key, eventName, data, names) {
  let holds = ctx.get(key);
  if (!holds) { holds = new Map(); ctx.set(key, holds); }
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (names.has(data.content_block.name)) holds.set(data.index, { id: data.content_block.id, name: data.content_block.name, partial: '' });
  }
  return holds;
}

function _inputDeltaEvent(index, partialJson) {
  return ['content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: partialJson } }];
}

function _parseToolInput(state) {
  try { return JSON.parse(state.partial); } catch (_e) { return null; }
}

function _emitHeldInput(state, index, input) {
  const events = [];
  if (input !== null) events.push(_inputDeltaEvent(index, JSON.stringify(input)));
  else if (state.partial) events.push(_inputDeltaEvent(index, state.partial));
  return events;
}

// Edit/MultiEdit missing required params -> rewrite to Read of the same file.
// Claude Code's client-side schema validator rejects Edit calls without
// old_string/new_string with InputValidationError, forcing a retry-loop.
// Convert the tool_use block in-flight: if the model emitted Edit-without-
// required-fields, the call almost always meant "I need to see what's in
// this file first". Synthesize a Read call (using offset/limit if the Edit
// hinted at them, else first 50 lines) so the model gets the content
// instead of a hard error.
const { editToReadFallback, isInvalidEditInput, isEditFamilyTool, isWriteTool } = require('./edit_validation');

const READ_FALLBACK_TOOL_NAMES = new Set(['Read']);
const READ_TOOL_NAMES = new Set(['Read']);
let _sessionReadCache = null;
function _readCache() {
  if (_sessionReadCache !== null) return _sessionReadCache;
  try { _sessionReadCache = require('./session_read_cache'); }
  catch (_e) { _sessionReadCache = false; }
  return _sessionReadCache;
}

function _editTargetUnread(input, ctx) {
  const fp = String((input && (input.file_path || input.path)) || '').trim();
  if (!fp || !fp.startsWith('/')) return true;
  const cache = _readCache();
  if (!cache) return true;
  const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
  if (!sessionId) return true;
  return !cache.hasRead(sessionId, fp);
}

function _shouldRewriteWriteToRead(input, ctx) {
  const fp = String((input && (input.file_path || input.path)) || '').trim();
  if (!fp) return false;
  if (!fp.startsWith('/')) return false;
  return _editTargetUnread(input, ctx);
}

function editFallbackToReadRewrite(eventName, data, ctx) {
  let editHolds = ctx.get('edit_fallback_hold');
  if (!editHolds) { editHolds = new Map(); ctx.set('edit_fallback_hold', editHolds); }
  let readHolds = ctx.get('read_track_hold');
  if (!readHolds) { readHolds = new Map(); ctx.set('read_track_hold', readHolds); }

  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') {
    if (isEditFamilyTool(data.content_block.name) || isWriteTool(data.content_block.name)) {
      editHolds.set(data.index, { id: data.content_block.id, name: data.content_block.name, startData: data, partial: '' });
      return null;
    }
    if (READ_FALLBACK_TOOL_NAMES.has(data.content_block.name)) {
      readHolds.set(data.index, { partial: '' });
    }
    return data;
  }
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const editState = editHolds.get(data.index);
    if (editState) { editState.partial += (data.delta.partial_json || ''); return null; }
    const readState = readHolds.get(data.index);
    if (readState) { readState.partial += (data.delta.partial_json || ''); }
    return data;
  }
  if (eventName !== 'content_block_stop' || !data) return data;

  const readState = readHolds.get(data.index);
  if (readState) {
    readHolds.delete(data.index);
    const cache = _readCache();
    const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
    if (cache && sessionId) {
      try {
        const readInput = JSON.parse(readState.partial || '{}');
        const fp = String((readInput && (readInput.file_path || readInput.path)) || '').trim();
        if (fp) cache.recordRead(sessionId, fp);
      } catch (_e) { /* silent-ok: malformed JSON; the real tool execution will surface the error */ }
    }
  }

  const editState = editHolds.get(data.index);
  if (!editState) return data;
  editHolds.delete(data.index);
  const parsed = _parseToolInput(editState);
  const isWrite = isWriteTool(editState.name);
  const invalid = isWrite ? false : isInvalidEditInput(parsed, { checkFs: true });
  const unread = !invalid && (isWrite ? _shouldRewriteWriteToRead(parsed, ctx) : _editTargetUnread(parsed, ctx));
  if (!invalid && !unread) {
    return { events: [
      ['content_block_start', editState.startData],
      _inputDeltaEvent(data.index, editState.partial || JSON.stringify(parsed)),
      ['content_block_stop', data],
    ]};
  }
  const readInput = editToReadFallback(parsed || {});
  const readStart = {
    ...editState.startData,
    content_block: { ...editState.startData.content_block, name: 'Read', input: {} },
  };
  if (unread) {
    const cache = _readCache();
    const sessionId = ctx && typeof ctx.get === 'function' ? ctx.get('session_id') : '';
    if (cache && sessionId && readInput.file_path) cache.recordRead(sessionId, readInput.file_path);
  }
  return { events: [
    ['content_block_start', readStart],
    _inputDeltaEvent(data.index, JSON.stringify(readInput)),
    ['content_block_stop', data],
  ]};
}

function _isPdfReadPath(file) {
  return /\.pdf(?:$|[?#])/i.test(String(file || '').trim());
}

function _normalizeReadInput(input) {
  if (!input || typeof input !== 'object') return input;
  const next = { ...input };
  const file = next.file_path || next.path || '';
  if (Object.prototype.hasOwnProperty.call(next, 'pages') && (!String(next.pages || '').trim() || !_isPdfReadPath(file))) delete next.pages;
  if (Number(next.limit) > 500) next.limit = 200;
  return next;
}

function readInputNormalizeRewrite(eventName, data, ctx) {
  const holds = _holdToolInput(ctx, 'read_hold', eventName, data, READ_TOOL_NAMES);
  if (eventName === 'content_block_start' && data && data.content_block && data.content_block.type === 'tool_use') return data;
  if (eventName === 'content_block_delta' && data && data.delta && data.delta.type === 'input_json_delta') {
    const state = holds.get(data.index);
    if (state) { state.partial += (data.delta.partial_json || ''); return null; }
    return data;
  }
  if (eventName !== 'content_block_stop' || !data) return data;
  const state = holds.get(data.index);
  if (!state) return data;
  holds.delete(data.index);
  const events = _emitHeldInput(state, data.index, _normalizeReadInput(_parseToolInput(state)));
  events.push(['content_block_stop', data]);
  return { events };
}

module.exports = {
  editFallbackToReadRewrite,
  readInputNormalizeRewrite,
  _normalizeReadInput,
};
