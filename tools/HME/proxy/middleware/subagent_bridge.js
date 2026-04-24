'use strict';
/**
 * HME subagent bridge — result capture only.
 *
 * Pairs with synthesis_reasoning.py's OVERDRIVE_VIA_SUBAGENT path. When
 * HME queues a reasoning task, it writes a self-instructing sentinel to
 * the tool_result (`[[HME_AGENT_TASK req_id=... prompt_file=... subagent_type=...]]`
 * with a one-line dispatch instruction). The agent sees the sentinel in
 * normal tool-result flow and fires `Agent(...)` on its next turn — no
 * system-message injection, no request-rewrite, zero context overhead
 * on the request side.
 *
 * This middleware's only job now is result routing: when an Agent
 * tool_result comes back with description `HME reasoning for <req_id>`,
 * write the Agent's text to tmp/hme-subagent-results/<req_id>.json and
 * move the queue entry to done/. HME callers poll that results dir to
 * resume synchronous flows that launched the reasoning task.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const QUEUE_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-queue');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-results');
const DONE_DIR = path.join(QUEUE_DIR, 'done');

function _ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_e) { /* ignore */ }
}

function _textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('');
  return '';
}

module.exports = {
  name: 'subagent_bridge',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Agent') return;
    const desc = (toolUse.input && toolUse.input.description) || '';
    const match = /HME reasoning for ([a-zA-Z0-9]+)/.exec(desc);
    if (!match) return;
    const reqId = match[1];
    // Capture Agent's text output and write it to the results dir so
    // future HME callers can synchronously consume it.
    const text = _textOf(toolResult);
    if (!text) return;
    _ensureDir(RESULTS_DIR);
    const outPath = path.join(RESULTS_DIR, `${reqId}.json`);
    try {
      fs.writeFileSync(outPath, JSON.stringify({
        req_id: reqId,
        text,
        captured_at: Date.now(),
      }));
    } catch (err) {
      ctx.warn(`subagent_bridge: result write failed for ${reqId}: ${err.message}`);
      return;
    }
    // Move the queue entry to done/ for audit trail.
    const queuePath = path.join(QUEUE_DIR, `${reqId}.json`);
    const donePath = path.join(DONE_DIR, `${reqId}.json`);
    try { _ensureDir(DONE_DIR); fs.renameSync(queuePath, donePath); } catch (_e) { /* ok if absent */ }
    _dispatched.add(reqId);
    ctx.emit({
      event: 'subagent_bridge_result_captured',
      req_id: reqId,
      bytes: text.length,
    });
  },
};
