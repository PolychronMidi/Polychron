'use strict';
/**
 * Bash error surfacing — when a Bash result contains an error signal buried
 * in long output (Traceback / ERROR / FAIL / segfault / OOM), append one
 * line with the matching snippet so the agent has a TL;DR pointer. Clean
 * runs pass through untouched. Destructive-command flags and file-write
 * KB summaries were removed as noise — the agent already knows what
 * command they ran, and per-file KB state is never agent-actionable.
 */

// Anchor to log-line conventions (start-of-line marker + colon or
// dedicated-phrase) so benign mentions like `"no errors found"`,
// `set -o errexit`, or grep output containing the literal word don't
// produce misleading [err] footers. Free-floating word-boundary
// matching previously caused the agent to chase non-issues.
const ERROR_LINE_RE = /^\s*(?:Traceback \(most recent call last\)|ERROR:|FAIL(?:ED)?:|Segmentation fault|core dumped|OutOfMemory(?:Error)?|OOMKilled|fatal:|panic:)/;

function _textOf(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  }
  return '';
}

function _firstErrorSnippet(text) {
  // Return the matching line PLUS up to 2 trailing context lines, capped
  // by total bytes — long Python tracebacks routinely exceed 120 chars
  // before reaching the salient phrase (e.g. `OutOfMemoryError: CUDA
  // out of memory. Tried to allocate …`). Slicing to per-line 120
  // chars used to crop to a path prefix and drop the diagnosis.
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (ERROR_LINE_RE.test(lines[i])) {
      const snippet = lines.slice(i, Math.min(i + 3, lines.length))
        .map((l) => l.trim()).filter(Boolean).join(' | ');
      return snippet.slice(0, 320);
    }
  }
  return '';
}

module.exports = {
  name: 'bash_enrichment',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (toolUse.name !== 'Bash') return;
    const text = _textOf(toolResult);
    if (!text || !ERROR_RE.test(text)) return;
    // Guard against restart-stacking: _processed is in-memory only, so on
    // every proxy restart the entire conversation's tool_results re-enter
    // the pipeline. Without this check we'd stack `[err]` footers N deep
    // after N restarts within a single conversation.
    if (ctx.hasHmeFooter(toolResult, '[err] ')) return;
    const snip = _firstErrorSnippet(text);
    if (!snip) return;
    ctx.appendToResult(toolResult, `\n[err] ${snip}`);
    ctx.markDirty();
    ctx.emit({ event: 'bash_error_surfaced' });
  },
};
