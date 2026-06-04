#!/usr/bin/env node
'use strict';
// Phase-2 P2: complete the immune loop (detect -> classify -> metabolize ->
// memory). Reads the recent hme-errors.log tail, classifies each line with the

const fs = require('fs');
const path = require('path');

function _root() {
  return process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
}

function run(root, opts = {}) {
  const limit = Number(opts.limit || 200);
  const recurThreshold = Number(opts.recur || 2);
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(root, 'log', 'hme-errors.log'), 'utf8')
      .split('\n').filter(Boolean).slice(-limit);
  } catch (_e) { return { scanned: 0, recurring: 0, appended: 0 }; }

  const { immuneResponse } = require('../proxy/coherence_organs');
  const counts = new Map();
  const samples = new Map();
  for (const line of lines) {
    const r = immuneResponse({ text: line });
    if (!r || r.classification === 'none') continue;
    counts.set(r.classification, (counts.get(r.classification) || 0) + 1);
    if (!samples.has(r.classification)) samples.set(r.classification, { action: r.action, line: line.slice(-200) });
  }

  const metabolism = require('../proxy/context_metabolism');
  let existing = new Set();
  try { existing = new Set((metabolism.readFacts(root) || []).map((f) => f && f.subject)); } catch (_e) { existing = new Set(); }

  let appended = 0;
  let recurring = 0;
  for (const [cls, n] of counts) {
    if (n < recurThreshold) continue;
    recurring += 1;
    const subject = `immune:${cls}`;
    if (existing.has(subject)) continue; // dedup: one durable fact per class
    const s = samples.get(cls) || {};
    try {
      metabolism.appendFact(root, {
        subject,
        content: `recurring ${cls} (${n}x in last ${lines.length} error lines; action=${s.action || 'observe'}): ${s.line || ''}`,
        stage: 'extracted_fact',
        proof_strength: 0.5,
        usefulness: n >= 4 ? 0.7 : 0.5,
        recency: 1,
        source: 'immune_classifier',
        retrieval_triggers: [cls],
      });
      appended += 1;
    } catch (_e) { /* silent-ok: metabolism ledger is advisory */ }
  }
  return { scanned: lines.length, recurring, appended };
}

if (require.main === module) {
  const opts = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)=(.+)$/.exec(a);
    if (m) opts[m[1]] = m[2];
  }
  const out = run(_root(), opts);
  process.stdout.write(`immune_metabolize: scanned=${out.scanned} recurring=${out.recurring} appended=${out.appended}\n`);
}

module.exports = { run };
