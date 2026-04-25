'use strict';
/**
 * Cascade-prediction injection — wires the Phase 6.1 `injected` arm
 * named-but-unbuilt for months and surfaced by peer-review iter 145.
 *
 * On every Edit/Write/NotebookEdit tool result, calls the worker's
 * /cascade_predict endpoint with the changed file path. The endpoint
 * (a) computes which modules are likely-affected via dep + feedback
 * graph traversal, (b) records the prediction with `injected=true` to
 * tmp/output/metrics/hme-predictions.jsonl, (c) returns the prediction
 * for footer rendering. The agent sees a `[HME cascade]` footer
 * naming the predicted ripple-modules; the post-pipeline reconciler
 * later compares the prediction to actual fingerprint shifts and
 * scores the cascade-prediction quality.
 *
 * Failure handling: silent-ok fall-through. The cascade prediction is
 * advisory enrichment, not a correctness gate; if the worker is down
 * or the file isn't analyzable, the tool result passes through
 * unchanged (no footer). The fire-event log in context_budget.js
 * picks up cascade-fires alongside the other enrichers.
 *
 * Footer cap: ≤6 predicted modules + total count, ≤180 chars total
 * to match dir_context.js's MAX_FOOTER_CHARS budget.
 */

const http = require('http');
const path = require('path');

const WORKER_PORT = (() => {
  const raw = Number(process.env.HME_MCP_PORT);
  return Number.isInteger(raw) && raw >= 1 && raw <= 65535 ? raw : 9098;
})();

const MAX_PREDICTED_SHOWN = 6;
const MAX_FOOTER_CHARS = 180;
const REQUEST_TIMEOUT_MS = 1500;  // tight — this fires on every Edit, must not stall

const TARGET_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);

function _post(pathName, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      host: '127.0.0.1', port: WORKER_PORT, path: pathName, method: 'POST',
      headers: { 'content-type': 'application/json',
                 'content-length': Buffer.byteLength(body) },
      timeout: timeoutMs,
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c.toString('utf8'); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(raw)); }
          catch (_) { resolve(null); }
        } else {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

module.exports = {
  name: 'cascade_prediction',

  async onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || !TARGET_TOOLS.has(toolUse.name || '')) return;
    const fp = (toolUse.input && toolUse.input.file_path) || '';
    if (!fp) return;
    // Skip non-source paths — node_modules, generated dirs, the metrics
    // logs themselves. Cascade analysis is meaningful only for code.
    if (/\/(node_modules|__pycache__|\.git|out|dist)\//.test(fp)) return;
    if (/\/output\/metrics\//.test(fp)) return;

    const result = await _post('/cascade_predict', { target_file: fp });
    if (!result || !result.logged) return;
    const predicted = Array.isArray(result.predicted) ? result.predicted : [];
    if (predicted.length === 0) {
      // Logged but no affected modules — not worth a footer.
      ctx.emit({ event: 'cascade_prediction_empty', target: result.target || path.basename(fp) });
      return;
    }
    const shown = predicted.slice(0, MAX_PREDICTED_SHOWN).join(', ');
    const tail = predicted.length > MAX_PREDICTED_SHOWN
      ? ` +${predicted.length - MAX_PREDICTED_SHOWN}` : '';
    let footer = `\n[HME cascade] ${result.target} → may ripple to: ${shown}${tail}`;
    if (footer.length > MAX_FOOTER_CHARS) {
      footer = footer.slice(0, MAX_FOOTER_CHARS - 1) + '…';
    }
    ctx.appendToResult(toolResult, footer);
    ctx.markDirty();
    ctx.emit({
      event: 'cascade_prediction_injected',
      target: result.target,
      n_predicted: predicted.length,
    });
  },
};
