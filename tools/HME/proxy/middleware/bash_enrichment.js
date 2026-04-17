'use strict';
/**
 * Bash error surfacing — when a Bash result contains an error signal buried
 * in long output (Traceback / ERROR / FAIL / segfault / OOM), append one
 * line with the matching snippet so the agent has a TL;DR pointer. Clean
 * runs pass through untouched. Destructive-command flags and file-write
 * KB summaries were removed as noise — the agent already knows what
 * command they ran, and per-file KB state is never agent-actionable.
 */

const ERROR_RE = /(\bTraceback\b|\bERROR\b|\bFAIL(?:ED)?\b|Segmentation fault|core dumped|OutOfMemory|OOMKilled)/;

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _firstErrorSnippet(text) {
  for (const line of text.split('\n')) {
    if (ERROR_RE.test(line)) return line.trim().slice(0, 120);
  }
  return '';
}

module.exports = {
  name: 'bash_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Bash') return;
    const text = _textOf(toolResult);
    if (!text || !ERROR_RE.test(text)) return;
    const snip = _firstErrorSnippet(text);
    if (!snip) return;
    ctx.appendToResult(toolResult, `\n[err] ${snip}`);
    ctx.markDirty();
    ctx.emit({ event: 'bash_error_surfaced' });
  },
};
