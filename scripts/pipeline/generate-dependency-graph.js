// scripts/generate-dependency-graph.js
// Builds a machine-readable dependency graph of global variable producers and
// consumers across all source files. Extends boot-order.json (which tracks
// providers) with the consumption side: which files READ which globals.
//
// Output: metrics/dependency-graph.json
//   - nodes: per-file metadata (subsystem, provides[], consumes[])
//   - edges: { from, to, globals[] } where `from` provides a global `to` consumes
//   - summary: aggregate statistics
//
// Run: node scripts/generate-dependency-graph.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT   = path.join(__dirname, '../..');
const SRC    = path.join(ROOT, 'src');
const OUTPUT = path.join(ROOT, 'metrics', 'dependency-graph.json');
const BOOT_ORDER_PATH = path.join(ROOT, 'metrics', 'boot-order.json');

// -Load boot-order.json for provider data -

function loadBootOrder() {
  if (!fs.existsSync(BOOT_ORDER_PATH)) {
    console.warn('Acceptable warning: generate-dependency-graph: boot-order.json not found, skipping.');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(BOOT_ORDER_PATH, 'utf8'));
  } catch (err) {
    console.warn('Acceptable warning: generate-dependency-graph: failed to parse boot-order.json: ' + (err && err.message ? err.message : err));
    return null;
  }
}

// -Detect subsystem from file path -

function getSubsystem(relPath) {
  const parts = relPath.replace(/\\/g, '/').split('/');
  // src/<subsystem>/...
  if (parts[0] === 'src' && parts.length >= 2) return parts[1];
  return 'root';
}

// -Build a set of all known globals and their providers -

function buildProviderMap(bootOrder) {
  const globalToProvider = new Map();
  for (const entry of bootOrder.bootOrder) {
    for (const g of entry.provides) {
      globalToProvider.set(g, entry.file);
    }
  }
  return globalToProvider;
}

// -Scan a JS file for global references (consumption) -

// We look for all identifiers that match known globals, excluding:
// - Lines that are assignments at column 0 (those are PROVIDERS, not consumers)
// - String literals and comments
// - Property access chains (obj.prop should not match 'prop')

function findConsumedGlobals(filePath, knownGlobals) {
  const src = fs.readFileSync(filePath, 'utf8');
  const consumed = new Set();

  for (const line of src.split(/\r?\n/)) {
    // Skip pure comment lines
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Skip column-0 assignment lines (these are provider lines)
    if (line.length > 0 && line[0] !== ' ' && line[0] !== '\t' && line[0] !== '/' && line[0] !== '*') {
      // Still scan for consumed globals on RHS of assignments
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0 && line[eqIdx + 1] !== '=') {
        // Only scan RHS
        scanFragment(line.slice(eqIdx + 1), knownGlobals, consumed);
        continue;
      }
    }

    scanFragment(line, knownGlobals, consumed);
  }

  return [...consumed].sort();
}

function scanFragment(fragment, knownGlobals, consumed) {
  // Remove string literals and template literals to avoid false positives
  const cleaned = fragment
    .replace(/'[^']*'/g, '""')
    .replace(/"[^"]*"/g, '""')
    .replace(/`[^`]*`/g, '""');

  // Match word-boundary identifiers, excluding property access (preceded by .)
  const re = /(?<![.\w$])([A-Za-z_$][\w$]*)(?=\s*[^=]|$)/g;
  let match;
  while ((match = re.exec(cleaned)) !== null) {
    const name = match[1];
    if (knownGlobals.has(name)) {
      consumed.add(name);
    }
  }
}

// -Build dependency edges -

function buildGraph(bootOrder, globalToProvider) {
  const knownGlobals = new Set(globalToProvider.keys());
  const nodes = {};
  const edgeMap = new Map(); // "from|to" -> Set<global>

  for (const entry of bootOrder.bootOrder) {
    const absPath = path.join(ROOT, entry.file);
    if (!fs.existsSync(absPath)) continue;

    const consumed = findConsumedGlobals(absPath, knownGlobals);

    // Remove self-provided globals from consumed list
    const selfProvided = new Set(entry.provides);
    const externalConsumed = consumed.filter(g => !selfProvided.has(g));

    nodes[entry.file] = {
      order: entry.order,
      subsystem: getSubsystem(entry.file),
      provides: entry.provides,
      consumes: externalConsumed
    };

    // Build edges
    for (const g of externalConsumed) {
      const provider = globalToProvider.get(g);
      if (!provider || provider === entry.file) continue;
      const edgeKey = provider + '|' + entry.file;
      if (!edgeMap.has(edgeKey)) edgeMap.set(edgeKey, new Set());
      edgeMap.get(edgeKey).add(g);
    }
  }

  const edges = [];
  for (const [key, globals] of edgeMap) {
    const [from, to] = key.split('|');
    edges.push({ from, to, globals: [...globals].sort() });
  }

  // Sort edges by source then target
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));

  return { nodes, edges };
}

// -Compute summary statistics -

function computeSummary(nodes, edges, globalToProvider) {
  const subsystems = {};
  let totalProvides = 0;
  let totalConsumes = 0;
  let maxFanIn = { file: '', count: 0 };
  let maxFanOut = { file: '', count: 0 };

  // Fan-in: how many files consume globals from this file
  const fanIn = new Map();
  // Fan-out: how many files this file consumes globals from
  const fanOut = new Map();

  for (const edge of edges) {
    fanOut.set(edge.to, (fanOut.get(edge.to) || 0) + 1);
    fanIn.set(edge.from, (fanIn.get(edge.from) || 0) + 1);
  }

  for (const [file, node] of Object.entries(nodes)) {
    const sub = node.subsystem;
    if (!subsystems[sub]) subsystems[sub] = { files: 0, provides: 0, consumes: 0 };
    subsystems[sub].files++;
    subsystems[sub].provides += node.provides.length;
    subsystems[sub].consumes += node.consumes.length;
    totalProvides += node.provides.length;
    totalConsumes += node.consumes.length;

    const fi = fanIn.get(file) || 0;
    const fo = fanOut.get(file) || 0;
    if (fi > maxFanIn.count) maxFanIn = { file, count: fi };
    if (fo > maxFanOut.count) maxFanOut = { file, count: fo };
  }

  // Cross-subsystem edges
  let crossSubsystemEdges = 0;
  for (const edge of edges) {
    const fromSub = getSubsystem(edge.from);
    const toSub = getSubsystem(edge.to);
    if (fromSub !== toSub) crossSubsystemEdges++;
  }

  return {
    totalFiles: Object.keys(nodes).length,
    totalGlobals: globalToProvider.size,
    totalProvides,
    totalConsumes,
    totalEdges: edges.length,
    crossSubsystemEdges,
    maxFanIn,
    maxFanOut,
    subsystems
  };
}

// -Main -

function main() {
  const bootOrder = loadBootOrder();
  if (!bootOrder) return;
  const globalToProvider = buildProviderMap(bootOrder);
  const { nodes, edges } = buildGraph(bootOrder, globalToProvider);
  const summary = computeSummary(nodes, edges, globalToProvider);

  const output = {
    meta: {
      generated: new Date().toISOString(),
      description: 'Dependency graph: global variable producers and consumers across all source files.'
    },
    summary,
    nodes,
    edges
  };

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2), 'utf8');

  console.log(
    'generate-dependency-graph: ' + summary.totalFiles + ' files, ' +
    summary.totalGlobals + ' globals, ' +
    summary.totalEdges + ' edges (' + summary.crossSubsystemEdges + ' cross-subsystem) -> metrics/dependency-graph.json'
  );
}

main();
