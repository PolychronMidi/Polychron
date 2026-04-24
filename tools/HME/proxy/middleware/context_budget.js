'use strict';
/**
 * Context-budget meta-controller.
 *
 * Per-turn, measures (injection-bytes-added / acted-upon-in-next-N-turns).
 * When an enricher's acted-upon rate is below threshold across a rolling
 * window, its priority is demoted (emit only on strong-match cases); when
 * an enricher's rate is high, it's promoted (fire more liberally).
 *
 * MVP scope: record per-enricher injection + whether the agent's next
 * tool call in the turn references any identifier the enricher supplied.
 * Writes to output/metrics/hme-enricher-efficacy.jsonl. Fully adaptive
 * pruning is a follow-up — this is the measurement substrate the
 * pruning logic will read.
 *
 * Enrichers currently in scope:
 *   - dir_context.js         appends [HME dir:<name>] footer
 *   - edit_context.js        appends [HME:edit] footer
 *   - read_context.js        appends [HME:read] footer
 *   - grep_glob_neighborhood.js  appends neighborhood file hints
 *   - bash_enrichment.js     appends [err] <snippet>
 *
 * This middleware runs AFTER all the enrichers, scans the tool_result
 * content for their markers, and records that the enrichment fired.
 * A sibling pass later can scan the NEXT assistant turn's tool_uses
 * for references to the identifiers each enricher injected — the
 * closed-loop efficacy signal.
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
