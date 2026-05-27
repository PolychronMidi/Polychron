'use strict';
/**
 * Agent job result capture middleware.
 *
 * HME reasoning jobs write a queue entry plus a normal tool-result sentinel.
 * The agent reacts to that sentinel by running Agent(...). This middleware
 * captures the Agent result, writes tmp/hme-subagent-results/<req_id>.json,
 * and moves the matching queue record to done/ for audit.
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const QUEUE_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-queue');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-results');
const DONE_DIR = path.join(QUEUE_DIR, 'done');

function _ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function _textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('');
  return '';
}

module.exports = {
  name: 'agent_jobs',

  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Agent') return;
    const desc = (toolUse.input && toolUse.input.description) || '';
    const { MARKERS } = require('./_markers');
    const match = MARKERS.HME_AGENT_TASK.reqIdRegex.exec(desc);
    if (!match) return;
    const reqId = match[1];
    const text = _textOf(toolResult);
    _ensureDir(RESULTS_DIR);
    const outPath = path.join(RESULTS_DIR, `${reqId}.json`);
    try {
      fs.writeFileSync(outPath, JSON.stringify({
        req_id: reqId,
        text,
        empty: !text,
        captured_at: Date.now(),
      }), { flag: 'wx' });
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        ctx.warn(`agent_jobs: duplicate capture for ${reqId} rejected (already in ${outPath})`);
        return;
      }
      ctx.warn(`agent_jobs: result write failed for ${reqId}: ${err.message}`);
      return;
    }
    const queuePath = path.join(QUEUE_DIR, `${reqId}.json`);
    const donePath = path.join(DONE_DIR, `${reqId}.json`);
    try {
      _ensureDir(DONE_DIR);
      fs.renameSync(queuePath, donePath);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') {
        ctx.warn(`agent_jobs: queue move failed for ${reqId}: ${err.message}`);
      }
    }
    ctx.emit({
      event: text ? 'agent_jobs_result_captured' : 'agent_jobs_empty_result',
      req_id: reqId,
      bytes: text.length,
    });
  },
};
