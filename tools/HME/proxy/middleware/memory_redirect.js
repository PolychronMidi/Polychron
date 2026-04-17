'use strict';
/**
 * Memory-feature redirect — hijacks any Read/Write/Edit/Glob/Grep whose input
 * touches the Claude Code native memory directory (`.claude/projects/*\/memory/`)
 * and replaces the tool_result with:
 *
 *   1. A deprecation banner
 *   2. A live HME KB semantic search, derived from whatever the agent tried
 *      to read/write
 *   3. (for Write/Edit only) the original hook-block response, so the agent
 *      can still see why the write didn't land on disk
 *
 * Rationale: the memory file feature is the wrong abstraction for Polychron —
 * the agent has been observed writing self-corrective "feedback memories"
 * about behavioral regressions instead of actually changing behavior. The
 * HME KB is the canonical place for project knowledge and is semantically
 * retrievable, so every memory-flavored tool call gets routed there.
 *
 * This middleware is the enforcement arm: Claude Code's hooks already block
 * memory writes, but the agent can still read. This closes the loop by
 * making every memory-flavored operation return KB content.
 */

const http = require('http');
const path = require('path');
const { SHIM_PORT } = require('../supervisor/children');

const MEMORY_PATH_RE = /\/\.claude\/projects\/[^/]+\/memory\//;
const BANNER = 'Memories feature is deprecated, replaced by HME KB.';
const TARGETED_TOOLS = new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep']);

function _isMemoryOp(toolUse) {
  const input = toolUse.input || {};
  const candidates = [input.file_path, input.path, input.pattern, input.target];
  return candidates.some((s) => typeof s === 'string' && MEMORY_PATH_RE.test(s));
}

function _deriveQuery(input) {
  if (input.file_path) {
    return path.basename(input.file_path, path.extname(input.file_path)).replace(/[_-]+/g, ' ');
  }
  if (input.pattern) return String(input.pattern).replace(/[^\w\s]+/g, ' ').trim();
  if (input.target) return String(input.target);
  if (input.path) {
    return path.basename(input.path, path.extname(input.path)).replace(/[_-]+/g, ' ');
  }
  return '';
}

function _kbSearch(query) {
  // Shim's /enrich endpoint is a direct KB semantic search — no onboarding
  // chain, no auto-narration, just RAG hits. Cleaner output than going
  // through the MCP /tool/learn path.
  return new Promise((resolve) => {
    if (!query || !query.trim()) { resolve('(no query derivable from tool input)'); return; }
    const body = Buffer.from(JSON.stringify({ query, top_k: 5 }), 'utf8');
    const req = http.request({
      hostname: '127.0.0.1',
      port: SHIM_PORT,
      path: '/enrich',
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': body.length },
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          // /enrich returns { kb_entries: [...], transcript: [...], ... }
          // Pull the KB entries into a compact formatted string.
          const entries = (json && json.kb_entries) || [];
          if (entries.length === 0) {
            resolve('(no KB hits for this query)');
            return;
          }
          const lines = [];
          for (const e of entries.slice(0, 5)) {
            const title = e.title || e.id || '(untitled)';
            const content = String(e.content || '').replace(/\s+/g, ' ').slice(0, 220);
            lines.push(`• ${title}`);
            if (content) lines.push(`  ${content}`);
          }
          resolve(lines.join('\n'));
        } catch (err) {
          resolve(`(KB parse error: ${err.message})`);
        }
      });
    });
    req.on('error', (err) => resolve(`(KB unreachable: ${err.message})`));
    req.on('timeout', () => { req.destroy(); resolve('(KB timeout)'); });
    req.write(body);
    req.end();
  });
}

function _resultText(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('');
  return '';
}

function _setResult(toolResult, text) {
  if (typeof toolResult.content === 'string') { toolResult.content = text; return; }
  if (Array.isArray(toolResult.content)) {
    toolResult.content = [{ type: 'text', text }];
    return;
  }
  toolResult.content = text;
}

module.exports = {
  name: 'memory_redirect',

  async onToolResult({ toolUse, toolResult, ctx }) {
    if (!TARGETED_TOOLS.has(toolUse.name)) return;
    if (!_isMemoryOp(toolUse)) return;

    const query = _deriveQuery(toolUse.input || {});
    const kbHits = await _kbSearch(query);

    const header = [
      BANNER,
      '',
      `(the ${toolUse.name} tool call was redirected; query derived from input: "${query}")`,
      '',
      '── HME KB semantic search ──',
    ].join('\n');

    let replacement = header + '\n' + kbHits;

    // For mutations (Write/Edit), preserve the original hook-block response
    // so the agent sees why the tool call failed on disk.
    if (toolUse.name === 'Write' || toolUse.name === 'Edit') {
      const original = _resultText(toolResult).trim();
      if (original) {
        replacement += '\n\n── original hook response ──\n' + original;
      }
    }

    _setResult(toolResult, replacement);
    ctx.markDirty();
    ctx.emit({
      event: 'memory_redirect',
      tool: toolUse.name,
      query: query.slice(0, 60),
    });
  },
};
