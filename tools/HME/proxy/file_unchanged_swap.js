'use strict';

// Cooperative rewrite for Claude Code's `file_unchanged` short-circuit.
// When the CLI emits `Wasted call — file unchanged since your last Read` (or

const WASTED_RE = /Wasted call .{0,4}file unchanged since your last Read|File unchanged since last read[\s\S]*refer to that instead/i;

function _textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('');
  }
  return '';
}

function _setText(block, text) {
  if (typeof block.content === 'string') { block.content = text; return; }
  if (Array.isArray(block.content)) { block.content = [{ type: 'text', text }]; return; }
  block.content = [{ type: 'text', text }];
}

function _cloneContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => ({ ...b }));
  return content;
}

function _buildToolUseIndex(messages) {
  const out = new Map();
  for (const msg of messages) {
    if (!msg || msg.role !== 'assistant') continue;
    const c = Array.isArray(msg.content) ? msg.content : [];
    for (const b of c) {
      if (b && b.type === 'tool_use' && b.id) {
        out.set(b.id, { name: b.name || '', input: b.input || {} });
      }
    }
  }
  return out;
}

function swapFileUnchanged(messages) {
  if (!Array.isArray(messages)) return 0;
  const toolUses = _buildToolUseIndex(messages);
  const lastReadContent = new Map();
  let swaps = 0;
  for (const msg of messages) {
    if (!msg || msg.role !== 'user') continue;
    const blocks = Array.isArray(msg.content) ? msg.content : [];
    for (const block of blocks) {
      if (!block || block.type !== 'tool_result' || !block.tool_use_id) continue;
      const use = toolUses.get(block.tool_use_id);
      if (!use || use.name !== 'Read') continue;
      const filePath = String((use.input && (use.input.file_path || use.input.path)) || '').trim();
      if (!filePath) continue;
      const text = _textOf(block.content);
      const isWasted = WASTED_RE.test(text);
      if (isWasted) {
        const earlier = lastReadContent.get(filePath);
        if (earlier) {
          const movedContent = _cloneContent(earlier.block.content);
          _setText(earlier.block, `[file content moved forward to a later Read of the same file at the same path]`);
          block.content = movedContent;
          lastReadContent.set(filePath, { block });
          swaps += 1;
        }
        continue;
      }
      lastReadContent.set(filePath, { block });
    }
  }
  return swaps;
}

module.exports = { swapFileUnchanged };
