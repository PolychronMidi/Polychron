// scripts/pipeline/generate-predictions.js
//
// Phase 3.4 — generate cascade predictions for this round's changed files.
// Reads dependency-graph.json, runs BFS from each changed src/ file, and
// appends prediction records to metrics/hme-predictions.jsonl.
//
// This is the PIPELINE trigger that review_unified couldn't reliably fire
// (import context issues). Runs as a POST_COMPOSITION step so it has the
// fresh dependency graph from the current pipeline run.
//
// Non-fatal diagnostic — prediction data feeds reconcile-predictions.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const DEPGRAPH = path.join(ROOT, 'metrics', 'dependency-graph.json');
const OUT = path.join(ROOT, 'metrics', 'hme-predictions.jsonl');
const MAX_DEPTH = 2;

function loadDepGraph() {
  if (!fs.existsSync(DEPGRAPH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DEPGRAPH, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function buildAdjacency(dg) {
  // edges: [{from, to, globals}]
  // Build forward adjacency: if A requires global from B, editing B affects A
  const adj = new Map();
  for (const edge of dg.edges || []) {
    const from = stemOf(edge.from);
    const to = stemOf(edge.to);
    if (!from || !to || from === to) continue;
    if (!adj.has(to)) adj.set(to, new Set());
    adj.get(to).add(from);
  }
  return adj;
}

function stemOf(filepath) {
  if (!filepath) return null;
  return path.basename(filepath, path.extname(filepath));
}

function bfs(adj, start, depth) {
  const visited = new Set([start]);
  const queue = [[start, 0]];
  const affected = [];
  while (queue.length > 0) {
    const [node, d] = queue.shift();
    if (d >= depth) continue;
    const neighbors = adj.get(node);
    if (!neighbors) continue;
    for (const n of neighbors) {
      if (!visited.has(n)) {
        visited.add(n);
        affected.push({ module: n, depth: d + 1 });
        queue.push([n, d + 1]);
      }
    }
  }
  return affected;
}

function getChangedFiles() {
  // Get files changed since last pipeline run. Use git diff against the
  // previous pipeline commit tag, or HEAD~1 as fallback.
  try {
    // Look back up to 30 commits for src/ changes. In rounds with only
    // tool/hook edits, src/ changes may be further back. The reconciler
    // handles duplicates, so wider window is safe.
    const diff = execSync('git diff HEAD~30 --name-only 2>/dev/null || git diff HEAD~5 --name-only 2>/dev/null || git diff --cached --name-only', {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 10000,
    });
    return diff.split('\n')
      .filter((f) => f.startsWith('src/') && f.endsWith('.js'))
      .map((f) => stemOf(f))
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function main() {
  const dg = loadDepGraph();
  if (!dg) {
    console.log('generate-predictions: no dependency graph — skip');
    return;
  }

  const adj = buildAdjacency(dg);
  const changed = getChangedFiles();

  if (changed.length === 0) {
    console.log('generate-predictions: no src/ changes in last commit — skip');
    return;
  }

  const ts = new Date().toISOString();
  let count = 0;

  for (const mod of changed) {
    const affected = bfs(adj, mod, MAX_DEPTH);
    if (affected.length === 0) continue;

    const record = {
      ts,
      target_module: mod,
      affected_modules: affected.map((a) => a.module),
      affected_count: affected.length,
      max_depth: MAX_DEPTH,
      injected: false,
      source: 'pipeline',
    };

    fs.appendFileSync(OUT, JSON.stringify(record) + '\n');
    count++;
  }

  console.log(`generate-predictions: ${count} predictions for ${changed.length} changed files (${adj.size} modules in graph)`);
}

main();
