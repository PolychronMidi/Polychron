'use strict';

// Claude Code's CLI emits a "Wasted call" tool_result when the model tries to
// Read a file that hasn't changed since an earlier Read this session. The
// short-circuit message is opaque to the model -- it sees "Wasted call -- file
// unchanged since your last Read" and often re-tries the Read instead of using
// the cached content, eating the entire turn budget on a loop. This middleware
// makes the short-circuit cooperative at zero net token cost: move the file
// content from the earlier slot into the current "Wasted call" slot, and
// replace the earlier slot's body with a tiny pointer. The model now sees
// fresh content at the position it was looking for, and the conversation
// remains structurally valid (every tool_use_id keeps its tool_result).

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
  if (Array.isArray(block.content)) {
    block.content = [{ type: 'text', text }];
    return;
  }
  block.content = [{ type: 'text', text }];
}

function _cloneContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => ({ ...b }));
  return content;
}

function _buildToolUseIndex(messages) {
  // Map tool_use_id -> { name, input }
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
  // For each Read'd file_path, remember the most recent prior tool_result
  // block that contained ACTUAL content (not itself a "Wasted call").
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
          // Move content forward: current slot gets the earlier file content,
          // earlier slot gets a one-line pointer. Tool_use_ids stay paired.
          const movedContent = _cloneContent(earlier.block.content);
          _setText(earlier.block, `[file content moved forward to a later Read of the same file at the same path]`);
          block.content = movedContent;
          // The slot we just wrote IS now the new "most recent actual content" for this file.
          lastReadContent.set(filePath, { block });
          swaps += 1;
        }
        // If no earlier content available, leave the "Wasted call" message as-is.
        continue;
      }
      // Actual Read content -- record it as the most recent good snapshot.
      lastReadContent.set(filePath, { block });
    }
  }
  return swaps;
}

module.exports = {
  name: 'file_unchanged_swap',
  swapFileUnchanged,
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.messages)) return;
    const swaps = swapFileUnchanged(payload.messages);
    if (swaps > 0 && ctx && typeof ctx.markDirty === 'function') ctx.markDirty();
  },
};
