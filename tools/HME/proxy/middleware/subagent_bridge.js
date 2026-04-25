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
    // Use the central markers registry so producer (synthesis_reasoning.py
    // emitting `HME reasoning for <reqId>`) and consumer (this regex) share
    // a single source of truth. See _markers.js for cross-component refs.
    const { MARKERS } = require('./_markers');
    const match = MARKERS.HME_AGENT_TASK.reqIdRegex.exec(desc);
    if (!match) return;
    const reqId = match[1];
    // Capture Agent's text output and write it to the results dir so
    // future HME callers can synchronously consume it.
    const text = _textOf(toolResult);
    _ensureDir(RESULTS_DIR);
    const outPath = path.join(RESULTS_DIR, `${reqId}.json`);
    try {
      // Use 'wx' flag so a duplicate capture for the same reqId is
      // rejected at the filesystem layer with EEXIST instead of
      // silently clobbering the first result. Agent retries + regex
      // false-positives were both caught by this before the anchor
      // tightening above; defense-in-depth.
      fs.writeFileSync(outPath, JSON.stringify({
        req_id: reqId,
        text,
        empty: !text,
        captured_at: Date.now(),
      }), { flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        ctx.warn(`subagent_bridge: duplicate capture for ${reqId} rejected (already in ${outPath})`);
        return;
      }
      ctx.warn(`subagent_bridge: result write failed for ${reqId}: ${err.message}`);
      return;
    }
    // Move the queue entry to done/ for audit trail — ALWAYS, even on
    // empty-text captures. Previously an empty Agent reply early-returned
    // before this rename, stranding the queue entry forever and making
    // the caller poll indefinitely with no diagnostic.
    const queuePath = path.join(QUEUE_DIR, `${reqId}.json`);
    const donePath = path.join(DONE_DIR, `${reqId}.json`);
    try { _ensureDir(DONE_DIR); fs.renameSync(queuePath, donePath); } catch (_e) { /* ok if absent */ }
    ctx.emit({
      event: text ? 'subagent_bridge_result_captured' : 'subagent_bridge_empty_result',
      req_id: reqId,
      bytes: text.length,
    });
  },
};
