// src/scripts/pipeline/generate-predictions.js
//
// Phase 3.4 -- generate cascade predictions for this round's changed files.
// Reads dependency-graph.json, runs BFS from each changed src/ file, and
// appends prediction records to metrics/hme-predictions.jsonl.
//
// This is the PIPELINE trigger that review_unified couldn't reliably fire
// (import context issues). Runs as a POST_COMPOSITION step so it has the
// fresh dependency graph from the current pipeline run.
//
// Non-fatal diagnostic -- prediction data feeds reconcile-predictions.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const METRICS_DIR = process.env.METRICS_DIR || path.join(ROOT, 'src', 'output', 'metrics');
const DEPGRAPH = path.join(METRICS_DIR, 'dependency-graph.json');
const OUT = path.join(METRICS_DIR, 'hme-predictions.jsonl');
// R12: depth 2 overpredicted (382 modules for 2 actual shifts = 0.5% accuracy).
// BFS at depth 1 = direct dependents only, typically 5-30 modules per source.
const MAX_DEPTH = 1;

function loadDepGraph() {
  if (!fs.existsSync(DEPGRAPH)) return null;
  try {
    return JSON.parse(fs.readFileSync(DEPGRAPH, 'utf8'));
  } catch (_e) {
    return null;
  }
}

function buildAdjacency(dg) {
  // edges: [{from, to, globals}] where `from` provides a global `to` consumes.
  const adj = new Map();
  for (const edge of dg.edges || []) {
    const from = stemOf(edge.from);
    const to = stemOf(edge.to);
    if (!from || !to || from === to) continue;
    if (!adj.has(from)) adj.set(from, new Set());
    adj.get(from).add(to);
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
  // R16 #4: align range with reconcile-predictions.js extractShiftedModules.
  try {
    for (const range of ['HEAD~2..HEAD', 'HEAD~1..HEAD', 'HEAD']) {
      try {
        const diff = execSync(`git diff --name-only ${range}`, {
          cwd: ROOT, encoding: 'utf8', timeout: 10000,
        });
        const files = diff.split('\n')
          .filter((f) => f.startsWith('src/') && f.endsWith('.js'))
          .map((f) => stemOf(f))
          .filter(Boolean);
        if (files.length > 0) return files;
      } catch (_e) { /* try next range */ }
    }
    return [];
  } catch (_e) {
    return [];
  }
}

function main() {
  const dg = loadDepGraph();
  if (!dg) {
    console.log('generate-predictions: no dependency graph -- skip');
    return;
  }

  const adj = buildAdjacency(dg);
  const changed = getChangedFiles();

  if (changed.length === 0) {
    console.log('generate-predictions: no src/ changes in last commit -- skip');
    return;
  }

  const ts = new Date().toISOString();
  let count = 0;

  for (const mod of changed) {
    const affected = bfs(adj, mod, MAX_DEPTH);
    // R16 #1: include the edited file itself in affected_modules. A file that
    const affectedWithSelf = [mod, ...affected.map((a) => a.module)];
    if (affectedWithSelf.length === 0) continue;

    const record = {
      ts,
      target_module: mod,
      affected_modules: affectedWithSelf,
      affected_count: affectedWithSelf.length,
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
