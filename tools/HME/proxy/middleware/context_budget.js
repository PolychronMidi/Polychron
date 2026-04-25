'use strict';
/**
 * Context-budget enricher-fire log.
 *
 * Records that an enricher's marker appeared in a tool_result. Writes
 * to output/metrics/hme-enricher-efficacy.jsonl as a flat append-only
 * fire-event log.
 *
 * IMPORTANT — what this is NOT (peer-review iter 145 honesty pass):
 *
 * The earlier docstring described a closed-loop adaptive controller
 * that would (a) measure acted-upon rate per enricher across a rolling
 * window, (b) demote low-acted-upon enrichers and promote high ones,
 * and (c) tune injection priority adaptively. That controller does
 * NOT exist in this file. Only the fire-event WRITE side is
 * implemented. The "sibling pass" mentioned in the original docstring
 * — the consumer that scans the next assistant turn's tool_uses for
 * references to enricher-supplied identifiers — was never built.
 *
 * The rolling-window pruning, the priority demotion/promotion, the
 * "fully adaptive" framing — all of it was aspirational design copy
 * that lived in the file as if it were describing the implementation.
 * Iter 145 named exactly this pattern (the human-side parallel of
 * agent exhaust_violation: documenting load-bearing infrastructure
 * that's actually unwired). Honest re-description: this is a fire log.
 *
 * If the closed-loop controller is built later, this docstring should
 * grow to describe the consumer at that time, not before.
 *
 * Enrichers whose markers this currently logs:
 *   - dir_context.js         [HME dir:<name>] footer
 *   - edit_context.js        [HME:edit] footer
 *   - read_context.js        [HME:read] footer
 *   - grep_glob_neighborhood.js  [HME neighborhood] footer
 *   - bash_enrichment.js     [err] snippet
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const METRICS = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-enricher-efficacy.jsonl');

const ENRICHER_MARKERS = {
  'dir_context':         /\[HME dir:/,
  'edit_context':        /\[HME:edit\]/,
  'read_context':        /\[HME:read\]/,
  'bash_enrichment':     /\n\[err\]/,
  'grep_neighborhood':   /\[HME neighborhood/,
};

function _textOf(tr) {
  const c = tr && tr.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('');
  return '';
}

function _recordFire(hits) {
  try {
    fs.mkdirSync(path.dirname(METRICS), { recursive: true });
    const entry = { ts: Math.floor(Date.now() / 1000), hits };
    fs.appendFileSync(METRICS, JSON.stringify(entry) + '\n');
    // Lightweight trim: every ~100 writes, keep tail 5000 lines.
    const counter = (_recordFire._n = (_recordFire._n || 0) + 1);
    if (counter % 100 !== 0) return;
    const stat = fs.statSync(METRICS);
    if (stat.size < 1024 * 1024) return;  // <1MB no-op
    const raw = fs.readFileSync(METRICS, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= 5000) return;
    const tail = lines.slice(-5000).join('\n') + '\n';
    fs.writeFileSync(METRICS + '.tmp', tail);
    fs.renameSync(METRICS + '.tmp', METRICS);
  } catch (_e) { /* silent-ok: telemetry only */ }
}

module.exports = {
  name: 'context_budget',

  onToolResult({ toolResult, ctx }) {
    const text = _textOf(toolResult);
    if (!text) return;
    const hits = {};
    for (const [name, re] of Object.entries(ENRICHER_MARKERS)) {
      if (re.test(text)) hits[name] = true;
    }
    if (Object.keys(hits).length === 0) return;
    _recordFire(hits);
    ctx.emit({ event: 'enricher_fired', hits: Object.keys(hits).join('|') });
  },
};
