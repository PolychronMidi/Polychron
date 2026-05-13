'use strict';
/**
 * Read tool result truncation — prevents context bloat from gargantuan
 * multi-thousand-line file reads. Limits enforced:
 *   - 200 lines per Read call (HME_READ_LIMIT_PER_CALL)
 *   - 600 lines per file cumulative (HME_READ_LIMIT_PER_FILE)
 *   - 2000 lines per turn total (HME_READ_LIMIT_PER_TURN)
 * Exceeding lines are replaced with a truncation notice showing what was cut.
 */

const PER_CALL = parseInt(process.env.HME_READ_LIMIT_PER_CALL || '200', 10);
const PER_FILE = parseInt(process.env.HME_READ_LIMIT_PER_FILE || '600', 10);
const PER_TURN = parseInt(process.env.HME_READ_LIMIT_PER_TURN || '2000', 10);

// Per-session tracking: cumulative lines read per file, reset on proxy restart.
const _fileLines = new Map();  // filePath -> total lines read this session
// Per-turn tracking resets after inactivity window (default 10 minutes).
const PER_TURN_RESET_MS = parseInt(process.env.HME_READ_LIMIT_RESET_MS || '600000', 10);
let _turnLines = 0;
let _lastReadAt = 0;

function _countLines(text) {
  if (!text || typeof text !== 'string') return 0;
  return (text.match(/\n/g) || []).length + 1;
}

function onToolResult(toolResult, toolUse, sessionId) {
  if (!toolResult || toolUse?.name !== 'Read' || !toolResult.content) return;
  const now = Date.now();
  if (now - _lastReadAt > PER_TURN_RESET_MS) _turnLines = 0;
  _lastReadAt = now;
  const blocks = Array.isArray(toolResult.content) ? toolResult.content : [{ type: 'text', text: String(toolResult.content) }];

  for (const block of blocks) {
    if (block.type !== 'text' || !block.text) continue;
    const filePath = toolUse?.input?.file_path || '';
    const fullLines = _countLines(block.text);

    // Check limits in priority order: per-call, per-file, per-turn
    let keptLines = fullLines;
    let notice = '';

    if (fullLines > PER_CALL) {
      keptLines = PER_CALL;
      notice = `Per-call limit (${PER_CALL} lines): ${fullLines - PER_CALL} line(s) truncated`;
    } else {
      const fileTotal = (_fileLines.get(filePath) || 0) + fullLines;
      if (fileTotal > PER_FILE) {
        const exceeded = fileTotal - PER_FILE;
        keptLines = Math.max(0, fullLines - exceeded);
        notice = `Per-file limit (${PER_FILE} lines cumulative): ${exceeded} line(s) cut from this read`;
      } else if (_turnLines + fullLines > PER_TURN) {
        const exceeded = (_turnLines + fullLines) - PER_TURN;
        keptLines = Math.max(0, fullLines - exceeded);
        notice = `Per-turn limit (${PER_TURN} lines): ${exceeded} line(s) cut from this read`;
      }
    }

    _fileLines.set(filePath, (_fileLines.get(filePath) || 0) + keptLines);
    _turnLines += keptLines;

    if (notice) {
      const lines = block.text.split('\n');
      block.text = lines.slice(0, keptLines).join('\n') +
        `\n\n[${notice}. Full file: ${fullLines} lines. Use Read with offset/limit to read specific sections.]`;
    }
  }
}

module.exports = {
  name: 'read_limit',
  priority: 8,
  onToolResult,
};
