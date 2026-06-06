# Context Capsule: review tool-result empty-marker semantics

## artifact
tools/HME/proxy/tool_result_semantics.js -- marks an EMPTY tool_result so the model
never sees a blank result it could misread. markEmptyResult appends [SUCCESS] (or
[FAIL] when is_error) only when the result text is empty and no marker already
exists; appendText handles string/array/null content shapes; hasMarker/textOfToolResult
inspect content; emptyMarker picks the marker.

## goal
Find decision-changing correctness flaws: a non-empty result wrongly marked, an
error result marked [SUCCESS] (or vice versa), a double-marking on replay, or an
appendText that corrupts the content shape a later reader expects. Cite the
function + line.

## constraints
markEmptyResult must be idempotent (no stacking on replay) and must only fire on a
genuinely empty result. is_error on the toolResult must win the SUCCESS/FAIL choice.
textOfToolResult/blockText (imported) is assumed correct. Review only the evidence
below unless you verify a fact with tools.

## rubric
Classify P0/P1/P2 with the claim-audit discipline. For each: function/line, exact
failure, contradictory evidence (which existing check already covers it, or "none
found after checking"), and a one-line fix. Reject style notes. A clean audit (no
decision-changing issue, with evidence) is a valid successful result.

## coverage
included: full tool_result_semantics.js source below -- textOfToolResult, appendText,
hasMarker, emptyMarker, markEmptyResult, and the SUCCESS_EMPTY/FAIL_EMPTY constants.
excluded: the imported request_shape blockText helper and the middleware that calls
markEmptyResult (assumed correct here).

## evidence
tools/HME/proxy/tool_result_semantics.js
```js
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
  // Mesh clean-audit P2 hardening (tool-result review): guard a non-object
  // toolResult so appendText's `toolResult.content = ...` can't throw under
  if (!toolResult || typeof toolResult !== 'object') return false;
  const text = textOfToolResult(toolResult);
  if (text && text.trim().length > 0) return false;
  if (hasMarker(toolResult)) return false;
  appendText(toolResult, emptyMarker(isError || toolResult.is_error === true));
  return true;
}

module.exports = { SUCCESS_EMPTY, FAIL_EMPTY, EDIT_SUCCESS, textOfToolResult, emptyMarker, markEmptyResult, hasMarker };

```
