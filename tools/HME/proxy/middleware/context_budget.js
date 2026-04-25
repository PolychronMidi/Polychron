'use strict';
/**
 * Enricher closed-loop efficacy measurement — wired per the original
 * Phase intent + iter 145 anti-pattern fix.
 *
 * Two-pass observer. First pass (`onToolResult`): when an enricher's
 * marker appears in a tool_result, extract the identifiers that
 * enricher INJECTED (file paths, module names, KB titles, dir keys
 * from the footer text), record them keyed by `tool_use_id` along
 * with which enrichers fired. Second pass (also `onToolResult` but
 * looking BACKWARD): for the just-completed tool_use, check whether
 * its INPUT references any identifier injected by the prior tool's
 * enricher footers. If yes, the prior enricher was acted-upon —
 * increment its hit/acted counters in
 * tmp/hme-enricher-efficacy-rates.json. The aggregate rates are
 * available to sibling middleware via `getEnricherEfficacy(name)`
 * for self-throttling decisions.
 *
 * What this is now (post-wiring):
 *   - WRITE side: fire-event log to hme-enricher-efficacy.jsonl
 *   - READ side: per-enricher rate file at hme-enricher-efficacy-rates.json
 *     ({"dir_context": {"fired": N, "acted": M, "rate": M/N}, ...})
 *   - PUBLIC: getEnricherEfficacy(name) → {fired, acted, rate}
 *
 * What this is NOT yet (named honestly so the gap is visible):
 *   - Adaptive throttling: enrichers don't yet read their own rates
 *     to self-demote. Each enricher could query getEnricherEfficacy
 *     and skip when its rate falls below a threshold; that's the
 *     next layer. The MEASUREMENT side is now load-bearing.
 *
 * Enricher identifier extractors:
 *   - dir_context: `[HME dir:<name>]` → name as identifier
 *   - edit_context: KB-title quotes, locked-key short forms
 *   - read_context: callers paths, hypothesis IDs
 *   - grep_neighborhood: file paths in the neighborhood footer
 *   - bash_enrichment: error-line snippet keywords (function/file names)
 */

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const METRICS = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-enricher-efficacy.jsonl');
const RATES = path.join(PROJECT_ROOT, 'tmp', 'hme-enricher-efficacy-rates.json');

const ENRICHER_MARKERS = {
  'dir_context':         /\[HME dir:/,
  'edit_context':        /\[HME:edit\]/,
  'read_context':        /\[HME:read\]/,
  'bash_enrichment':     /\n\[err\]/,
  'grep_neighborhood':   /\[HME neighborhood/,
};

// Extractors that return the identifiers each enricher injected. Looked
// up in the tool_result text after the enricher's marker matched.
// Identifiers are strings the agent might subsequently reference in a
// tool_use input — file paths, module/function names, KB titles.
const IDENTIFIER_EXTRACTORS = {
  // dir name from `[HME dir:<name>]`
  'dir_context': (text) => {
    const out = [];
    const re = /\[HME dir:([\w./-]+)\]/g;
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1]);
    return out;
  },
  // KB-title quote and any backticked symbol after [HME:edit]
  'edit_context': (text) => {
    const out = [];
    const section = text.slice(text.indexOf('[HME:edit]'));
    const titleRe = /(?:bugfix|antipattern):"([^"]{3,80})"/g;
    let m;
    while ((m = titleRe.exec(section)) !== null) out.push(m[1]);
    const keyRe = /`([\w.]{3,40})`/g;
    while ((m = keyRe.exec(section)) !== null) out.push(m[1]);
    return out;
  },
  // file paths and hypothesis IDs from [HME:read]
  'read_context': (text) => {
    const out = [];
    const section = text.slice(text.indexOf('[HME:read]'));
    const pathRe = /([a-zA-Z_][\w./-]+\.(?:js|py|ts|sh|md|json))/g;
    let m;
    while ((m = pathRe.exec(section)) !== null) out.push(m[1]);
    return out.slice(0, 20);
  },
  // file paths in `[HME neighborhood:relDir/ (N hits)]` block
  'grep_neighborhood': (text) => {
    const out = [];
    const section = text.slice(text.indexOf('[HME neighborhood'));
    const pathRe = /\b([a-zA-Z_][\w./-]+\.(?:js|py|ts|sh|md|json))\b/g;
    let m;
    while ((m = pathRe.exec(section)) !== null) out.push(m[1]);
    return out.slice(0, 20);
  },
  // identifiers from the [err] line — function names, file paths
  'bash_enrichment': (text) => {
    const out = [];
    const idx = text.indexOf('\n[err]');
    if (idx < 0) return out;
    const section = text.slice(idx, idx + 500);
    const idRe = /\b([A-Za-z_]\w{4,40})\b/g;
    let m;
    while ((m = idRe.exec(section)) !== null) {
      if (!['error', 'Error', 'ERROR', 'failed', 'Failed', 'FAIL'].includes(m[1])) {
        out.push(m[1]);
      }
    }
    return out.slice(0, 10);
  },
};

// Pending-injection map: tool_use_id → { fired_enrichers, identifiers }.
// Populated when a tool_result lands; consumed when the NEXT tool_use's
// input contains any of the recorded identifiers.
const _pending = new Map();
const _MAX_PENDING_AGE_MS = 5 * 60_000; // 5 min — older entries pruned

function _prunePending() {
  const cutoff = Date.now() - _MAX_PENDING_AGE_MS;
  for (const [tid, entry] of _pending) {
    if (entry.ts < cutoff) _pending.delete(tid);
  }
}

function _loadRates() {
  try {
    if (fs.existsSync(RATES)) return JSON.parse(fs.readFileSync(RATES, 'utf8'));
  } catch (_e) { /* silent-ok: rates file is recoverable from fire log */ }
  return {};
}

function _saveRates(rates) {
  try {
    fs.mkdirSync(path.dirname(RATES), { recursive: true });
    const tmp = RATES + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(rates, null, 2));
    fs.renameSync(tmp, RATES);
  } catch (_e) { /* silent-ok: rates persistence is best-effort */ }
}

function _bumpRate(name, kind) {
  const rates = _loadRates();
  if (!rates[name]) rates[name] = { fired: 0, acted: 0, rate: 0 };
  rates[name][kind] = (rates[name][kind] || 0) + 1;
  const fired = rates[name].fired || 0;
  const acted = rates[name].acted || 0;
  rates[name].rate = fired > 0 ? Number((acted / fired).toFixed(3)) : 0;
  _saveRates(rates);
}

function _recordFire(hits) {
  try {
    fs.mkdirSync(path.dirname(METRICS), { recursive: true });
    const entry = { ts: Math.floor(Date.now() / 1000), hits };
    fs.appendFileSync(METRICS, JSON.stringify(entry) + '\n');
    const counter = (_recordFire._n = (_recordFire._n || 0) + 1);
    if (counter % 100 !== 0) return;
    const stat = fs.statSync(METRICS);
    if (stat.size < 1024 * 1024) return;
    const raw = fs.readFileSync(METRICS, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= 5000) return;
    const tail = lines.slice(-5000).join('\n') + '\n';
    fs.writeFileSync(METRICS + '.tmp', tail);
    fs.renameSync(METRICS + '.tmp', METRICS);
  } catch (_e) { /* silent-ok: telemetry only — fire log is recoverable */ }
}

/**
 * Public read-side API for sibling middleware. Returns
 * {fired, acted, rate} for the named enricher, or {fired:0, acted:0, rate:0}
 * if no data yet. Sibling enrichers can call this to self-throttle when
 * their acted-upon rate falls below a threshold (the adaptive layer the
 * iter-145 honesty pass named as "not yet built").
 */
function getEnricherEfficacy(name) {
  const rates = _loadRates();
  return rates[name] || { fired: 0, acted: 0, rate: 0 };
}

function _scanInputForIdentifiers(toolUseInput, identifiers) {
  // Flatten input to a string and search for any identifier substring
  if (!identifiers || identifiers.length === 0) return [];
  let blob = '';
  try { blob = JSON.stringify(toolUseInput || {}); } catch (_e) { return []; }
  const matched = [];
  for (const id of identifiers) {
    if (id && blob.includes(id)) matched.push(id);
  }
  return matched;
}

module.exports = {
  name: 'context_budget',
  // Exposed for sibling middleware to self-throttle.
  getEnricherEfficacy,

  onToolResult({ toolUse, toolResult, ctx }) {
    _prunePending();
    const text = _textOf(toolResult);

    // ============================================
    // READ-SIDE FIRST: did THIS tool_use's input reference identifiers
    // that a PRIOR enricher footer injected? If yes, that prior
    // enricher was acted-upon. Bump its `acted` counter.
    // ============================================
    const tuInput = (toolUse && toolUse.input) || {};
    let actedBumped = 0;
    for (const [pendingId, entry] of _pending) {
      if (pendingId === (toolUse && toolUse.id)) continue; // skip self
      const matched = _scanInputForIdentifiers(tuInput, entry.identifiers);
      if (matched.length > 0) {
        for (const enricher of entry.enrichers) {
          _bumpRate(enricher, 'acted');
          actedBumped++;
        }
        // Mark this pending entry consumed so it doesn't double-count
        // on a subsequent tool_use.
        _pending.delete(pendingId);
      }
    }
    if (actedBumped > 0) {
      ctx.emit({ event: 'enricher_acted_upon', count: actedBumped });
    }

    // ============================================
    // WRITE-SIDE: detect which enrichers fired on THIS tool_result and
    // extract identifiers they injected. Store keyed by tool_use_id so
    // the NEXT tool_use's read-side scan can match against them.
    // ============================================
    if (!text) return;
    const hits = {};
    const identifiers = [];
    const firedNames = [];
    for (const [name, re] of Object.entries(ENRICHER_MARKERS)) {
      if (re.test(text)) {
        hits[name] = true;
        firedNames.push(name);
        const extractor = IDENTIFIER_EXTRACTORS[name];
        if (extractor) {
          for (const id of extractor(text)) {
            if (id && !identifiers.includes(id)) identifiers.push(id);
          }
        }
        _bumpRate(name, 'fired');
      }
    }
    if (firedNames.length === 0) return;

    _recordFire(hits);
    ctx.emit({
      event: 'enricher_fired',
      hits: firedNames.join('|'),
      n_identifiers: identifiers.length,
    });

    // Stash the watch list. If toolUse has no id (rare path), skip —
    // we can't correlate against the next tool_use without an id.
    const tid = toolUse && toolUse.id;
    if (tid) {
      _pending.set(tid, {
        ts: Date.now(),
        enrichers: firedNames,
        identifiers,
      });
    }
  },
};
