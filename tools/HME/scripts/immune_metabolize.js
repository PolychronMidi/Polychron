#!/usr/bin/env node
'use strict';
// Phase-2 P2: complete the immune loop (detect -> classify -> metabolize ->
// memory). Reads the recent hme-errors.log tail, classifies each line with the

const fs = require('fs');
const path = require('path');

function _root() {
  if (!process.env.PROJECT_ROOT) throw new Error('PROJECT_ROOT is required');
  return process.env.PROJECT_ROOT;
}

function run(root, opts = {}) {
  const limit = Number(opts.limit || 200);
  const recurThreshold = Number(opts.recur || 2);
  let lines = [];
  try {
    lines = fs.readFileSync(path.join(root, 'log', 'hme-errors.log'), 'utf8')
      .split('\n').filter(Boolean).slice(-limit);
  } catch (_e) { return { scanned: 0, recurring: 0, appended: 0 }; }

  const recencyDecay = Number(opts.decay || 0.6);
  const dropBelow = Number(opts.drop || 0.15);

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
  let allFacts = [];
  try { allFacts = metabolism.readFacts(root) || []; } catch (_e) { allFacts = []; }
  const others = allFacts.filter((f) => !f || f.source !== 'immune_classifier');
  const priorImmune = new Map();
  for (const f of allFacts) if (f && f.source === 'immune_classifier') priorImmune.set(f.subject, f);

  // Reconcile so immune memory tracks CURRENT recurrence, not first-seen-forever
  // (Flag 3): a class still recurring is refreshed (recency=1, bumped count); a
  const nowIso = new Date().toISOString();
  const reconciled = [];
  const seen = new Set();
  let appended = 0;
  let refreshed = 0;
  let droppedOut = 0;
  let recurring = 0;
  for (const [cls, n] of counts) {
    if (n < recurThreshold) continue;
    recurring += 1;
    const subject = `immune:${cls}`;
    seen.add(subject);
    const s = samples.get(cls) || {};
    if (priorImmune.has(subject)) refreshed += 1; else appended += 1;
    reconciled.push({
      ts: nowIso,
      subject,
      content: `recurring ${cls} (now ${n}x in last ${lines.length} error lines; action=${s.action || 'observe'}): ${s.line || ''}`,
      stage: 'extracted_fact',
      proof_strength: 0.5,
      usefulness: n >= 4 ? 0.7 : 0.5,
      recency: 1,
      source: 'immune_classifier',
      retrieval_triggers: [cls],
    });
  }
  for (const [subject, prev] of priorImmune) {
    if (seen.has(subject)) continue;
    const decayed = Number(((prev.recency == null ? 1 : prev.recency) * recencyDecay).toFixed(4));
    if (decayed < dropBelow) { droppedOut += 1; continue; } // faded out of current memory
    reconciled.push({ ...prev, recency: decayed });
  }
  try { metabolism.writeFacts(root, others.concat(reconciled)); }
  catch (_e) { /* silent-ok: metabolism ledger is advisory */ }
  return { scanned: lines.length, recurring, appended, refreshed, dropped_out: droppedOut };
}

if (require.main === module) {
  const opts = {};
  for (const a of process.argv.slice(2)) {
    const m = /^--([a-z]+)=(.+)$/.exec(a);
    if (m) opts[m[1]] = m[2];
  }
  const out = run(_root(), opts);
  process.stdout.write(`immune_metabolize: scanned=${out.scanned} recurring=${out.recurring} appended=${out.appended} refreshed=${out.refreshed} dropped_out=${out.dropped_out}\n`);
}

module.exports = { run };
