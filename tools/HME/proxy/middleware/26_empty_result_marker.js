'use strict';
/**
 * Every tool execution returns either SUCCESS or FAIL. When the tool body is empty the harness silently dropped the status line; this middleware writes it explicitly so the agent never has to infer outcome from absent signal. is_error=true -> [FAIL], is_error=false -> [SUCCESS]. Pass-through when the body already contains content (the tool already said something).
 */

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

const _SUCCESS = '[SUCCESS] tool completed with no output body';
const _FAIL = '[FAIL] tool errored with no error message body';

module.exports = {
  name: 'empty_result_marker',

  onToolResult({ toolUse, toolResult, ctx }) {
    // surface deny reason from bridge temp file; consumed on read
    const rf = require('path').join(ctx.projectRoot || process.env.PROJECT_ROOT || '.', 'tmp', 'hme-last-deny-reason.txt');
    try {
      if (fs.existsSync(rf)) {
        const reason = fs.readFileSync(rf, 'utf8').trim();
        fs.unlinkSync(rf);
        if (reason) { ctx.replaceResult(toolResult, '[BLOCKED] ' + reason); ctx.markDirty(); return; }
      }
    } catch (_) { /* silent-ok */ }
    const text = _textOf(toolResult);
    if (text && text.trim().length > 0) return;
    if (ctx.hasHmeFooter(toolResult, '[SUCCESS]') || ctx.hasHmeFooter(toolResult, '[FAIL]')) return;
    const marker = toolResult.is_error === true ? _FAIL : _SUCCESS;
    ctx.appendToResult(toolResult, marker);
    ctx.markDirty();
    ctx.emit({ event: 'empty_tool_result_marked', tool: toolUse.name, status: toolResult.is_error ? 'FAIL' : 'SUCCESS' });
  },
};
