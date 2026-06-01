'use strict';

const { blockText: _blockText } = require('./request_shape');

const SUCCESS_EMPTY = '[SUCCESS]';
const FAIL_EMPTY = '[FAIL] tool errored with no error message body';
const EDIT_SUCCESS = '[SUCCESS] edit applied';

function textOfToolResult(toolResult) {
  return _blockText({ type: 'tool_result', content: toolResult && toolResult.content }, { toolResults: true });
}

function appendText(toolResult, text) {
  if (typeof toolResult.content === 'string') toolResult.content += text;
  else if (Array.isArray(toolResult.content)) toolResult.content.push({ type: 'text', text });
  else toolResult.content = text;
}

function hasMarker(toolResult) {
  const text = textOfToolResult(toolResult);
  return text.includes('[SUCCESS]') || text.includes('[FAIL]');
}

function emptyMarker(isError = false) {
  return isError ? FAIL_EMPTY : SUCCESS_EMPTY;
}

function markEmptyResult(toolResult, isError = false) {
  if (!toolResult) return false;
  const text = textOfToolResult(toolResult);
  if (text && text.trim().length > 0) return false;
  if (hasMarker(toolResult)) return false;
  appendText(toolResult, emptyMarker(isError || toolResult.is_error === true));
  return true;
}

module.exports = { SUCCESS_EMPTY, FAIL_EMPTY, EDIT_SUCCESS, textOfToolResult, emptyMarker, markEmptyResult, hasMarker };
