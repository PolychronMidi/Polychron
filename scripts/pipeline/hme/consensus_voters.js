// R32: voter functions extracted from compute-consensus.js.
//
// Each voter produces a scalar in [-1, +1] or null (insufficient data).
// Adding a new voter is a matter of defining its function here and
// importing it in compute-consensus.js main voters block — no touching
// the orchestration layer.

'use strict';

const fs = require('fs');
const path = require('path');

function makeVoters(ROOT) {
  function loadJson(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
    catch (_e) { return null; }
  }
  function clamp1(x) { return Math.max(-1, Math.min(1, x)); }

  // HCI voter: hci=80 → 0, hci=100 → +1, hci=60 → -1.
  function voteHci() {
    const summary = loadJson(path.join(ROOT, 'metrics', 'pipeline-summary.json'));
    if (!summary || typeof summary.hci !== 'number') return null;
    return clamp1((summary.hci - 80) / 20);
  }

  // Invariant pass-rate voter. Tight band: 90%=0, 95%=+1, 85%=-1.
  function voteInvariants() {
    const hist = loadJson(path.join(ROOT, 'metrics', 'hme-invariant-history.json'));
    if (!hist || !hist.last_result) return null;
    const results = Object.values(hist.last_result);
    if (results.length === 0) return null;
    const pass = results.filter((v) => v === 'pass').length;
    const rate = pass / results.length;
    return clamp1(2 * (rate - 0.90) / 0.10);
  }

  // Prediction recall voter. Skipped rounds return null.
  function votePredictionRecall() {
    const acc = loadJson(path.join(ROOT, 'metrics', 'hme-prediction-accuracy.json'));
    if (!acc || !Array.isArray(acc.rounds) || acc.rounds.length === 0) return null;
    const last = acc.rounds[acc.rounds.length - 1];
    if (last.skipped || typeof last.recall !== 'number') return null;
    return clamp1(2 * last.recall - 1);
  }

  // Verdict numeric voter (fingerprint result mapped to scalar).
  function voteVerdict() {
    const mc = loadJson(path.join(ROOT, 'metrics', 'hme-musical-correlation.json'));
    if (!mc || !Array.isArray(mc.history) || mc.history.length === 0) return null;
    const last = mc.history[mc.history.length - 1];
    if (typeof last.verdict_numeric !== 'number') return null;
    return clamp1(2 * last.verdict_numeric - 1);
  }

  // Axis rebalance cost trend voter. Rising > 50% over 3 rounds → -1.
  function voteAxisCostTrend() {
    const histPath = path.join(ROOT, 'metrics', 'legacy-override-history.jsonl');
    if (!fs.existsSync(histPath)) return null;
    const rows = fs.readFileSync(histPath, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch (_e) { return null; } })
      .filter(Boolean);
    if (rows.length < 3) return null;
    const tail = rows.slice(-3);
    const costs = tail.map((r) => {
      const total = Object.values(r.per_axis_adj || {})
        .reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
      return r.beat_count > 0 ? (total / r.beat_count) * 100 : null;
    }).filter((c) => c !== null);
    if (costs.length < 3 || costs[0] <= 0) return null;
    const growth = (costs[costs.length - 1] - costs[0]) / costs[0];
    return clamp1(-growth / 0.5);
  }

  // CLAP tension stability voter. In [0.2, 0.6] band → +1; linear decay outside.
  function voteClapStability() {
    const perc = loadJson(path.join(ROOT, 'metrics', 'perceptual-report.json'));
    const clap = perc && perc.clap && perc.clap.queries;
    if (!clap) return null;
    const tensionKey = Object.keys(clap).find((k) => /tension/i.test(k));
    const peak = tensionKey && typeof clap[tensionKey].peak === 'number'
      ? clap[tensionKey].peak : null;
    if (peak === null) return null;
    const mid = 0.4;
    const halfBand = 0.2;
    const dist = Math.abs(peak - mid);
    if (dist <= halfBand) return 1;
    return clamp1(1 - (dist - halfBand) / halfBand * 2);
  }

  // Listening verdict voter (user-confirmed, from hme-ground-truth.jsonl).
  function voteListeningVerdict() {
    const gtPath = path.join(ROOT, 'metrics', 'hme-ground-truth.jsonl');
    if (!fs.existsSync(gtPath)) return null;
    const lines = fs.readFileSync(gtPath, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 0) return null;
    const last = (() => { try { return JSON.parse(lines[lines.length - 1]); }
                          catch (_e) { return null; } })();
    if (!last) return null;
    const sentiment = (last.tags || []).map((t) => String(t).toLowerCase());
    if (sentiment.includes('legendary')) return 1;
    if (sentiment.includes('stable') || sentiment.includes('good')) return 0.5;
    if (sentiment.includes('drifted') || sentiment.includes('degraded')) return -0.5;
    if (sentiment.includes('broken') || sentiment.includes('bad')) return -1;
    return null;
  }

  return {
    voteHci, voteInvariants, votePredictionRecall, voteVerdict,
    voteAxisCostTrend, voteClapStability, voteListeningVerdict,
    loadJson, clamp1,
  };
}

module.exports = { makeVoters };
