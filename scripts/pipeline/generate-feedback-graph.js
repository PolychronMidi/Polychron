// scripts/generate-feedback-graph.js
// Auto-generates metrics/feedback_graph.json by scanning source code for
// closedLoopController.create() and feedbackRegistry.registerLoop() calls,
// then merging with manually curated annotations from the existing JSON.
//
// New source loops get scaffolded entries with TODO placeholders.
// Conceptual loops and firewalls are preserved verbatim from the existing JSON.
//
// Modes:
//   node scripts/generate-feedback-graph.js           -- generate/merge
//   node scripts/generate-feedback-graph.js --check   -- exit 1 if JSON is stale
//
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC  = path.join(ROOT, 'src');
const METRICS  = path.join(ROOT, 'metrics');
const GRAPH_PATH = path.join(METRICS, 'feedback_graph.json');

const CHECK_MODE = process.argv.includes('--check');

// -Filesystem helpers -

function findJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findJsFiles(full));
    } else if (entry.name.endsWith('.js')) {
      results.push(full);
    }
  }
  return results;
}

function isInsideJSDoc(src, matchIndex) {
  const before = src.slice(0, matchIndex);
  const lastDocOpen = before.lastIndexOf('/**');
  const lastDocClose = before.lastIndexOf('*/');
  return lastDocOpen > lastDocClose;
}

// -Source scanning -

/**
 * Scan all .js files under src/ for feedback loop registrations.
 * Returns Map<name, { name, file, type, sourceDomain?, targetDomain? }>
 */
function scanSourceLoops() {
  const loops = new Map();
  const allJsFiles = findJsFiles(SRC);

  for (const filePath of allJsFiles) {
    const src = fs.readFileSync(filePath, 'utf8');
    const relPath = path.relative(SRC, filePath).replace(/\\/g, '/');

    // feedbackRegistry.registerLoop('name', 'sourceDomain', 'targetDomain', ...)
    const regLoopRe = /feedbackRegistry\.registerLoop\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g;
    for (const match of src.matchAll(regLoopRe)) {
      loops.set(match[1], {
        name: match[1],
        file: relPath,
        type: 'registerLoop',
        sourceDomain: match[2],
        targetDomain: match[3]
      });
    }

    // closedLoopController.create({ name: '...', ... sourceDomain: '...', targetDomain: '...' })
    const clcRe = /closedLoopController\.create\(\s*\{([^}]*)\}/gs;
    for (const match of src.matchAll(clcRe)) {
      if (isInsideJSDoc(src, match.index)) continue;

      const body = match[1];
      const nameMatch = body.match(/name:\s*'([^']+)'/);
      if (!nameMatch) continue;

      const sdMatch = body.match(/sourceDomain:\s*'([^']+)'/);
      const tdMatch = body.match(/targetDomain:\s*'([^']+)'/);

      loops.set(nameMatch[1], {
        name: nameMatch[1],
        file: relPath,
        type: 'closedLoopController',
        sourceDomain: sdMatch ? sdMatch[1] : null,
        targetDomain: tdMatch ? tdMatch[1] : null
      });
    }
  }

  return loops;
}

// -Load existing JSON -

function loadExistingGraph() {
  if (!fs.existsSync(GRAPH_PATH)) {
    return {
      firewalls: {},
      feedbackLoops: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(GRAPH_PATH, 'utf8'));
  } catch (err) {
    console.error('generate-feedback-graph: WARNING - failed to parse existing JSON:', err.message);
    return { firewalls: {}, feedbackLoops: [] };
  }
}

// -Merge logic -

/**
 * Merge source-scanned loops with existing JSON annotations.
 * - Existing entries: preserve all manual annotations, update sourceDomain/targetDomain
 *   from source if the existing values look like raw domain identifiers.
 * - New entries: scaffold with TODO placeholders.
 * - Conceptual entries: preserve verbatim (no source registration expected).
 */
function mergeLoops(existingLoops, sourceLoops) {
  const merged = [];
  const handledSourceNames = new Set();

  // Preserve existing order: walk existing loops, updating as needed
  for (const loop of existingLoops) {
    if (loop.conceptual) {
      // Conceptual loops have no source registration - preserve verbatim
      // If a conceptual loop's module matches a source registration, mark handled
      // to prevent duplicate scaffolding
      if (loop.module && sourceLoops.has(loop.module)) {
        handledSourceNames.add(loop.module);
      }
      merged.push(loop);
      continue;
    }
    if (sourceLoops.has(loop.module)) {
      // Existing entry with matching source registration - preserve annotations
      merged.push(loop);
      handledSourceNames.add(loop.module);
    } else {
      // Orphaned: in JSON but not in source. Keep with warning.
      console.log('generate-feedback-graph: WARNING - loop "' + loop.module + '" in JSON has no source registration (keeping)');
      merged.push(loop);
    }
  }

  // Append new source loops not yet in JSON
  for (const [name, srcLoop] of sourceLoops) {
    if (handledSourceNames.has(name)) continue; // already handled above
    // New loop - scaffold entry
    const kebab = name.replace(/\./g, '-').replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    merged.push({
      id: kebab,
      module: name,
      sourceDomain: srcLoop.sourceDomain || 'TODO',
      targetDomain: srcLoop.targetDomain || 'TODO',
      latency: 'beat-delayed',
      firewallsCrossed: ['REGISTRY_DAMPENING'],
      mechanism: 'TODO: describe feedback mechanism'
    });
    console.log('generate-feedback-graph: NEW loop scaffolded:', name);
  }

  return merged;
}

// -Build output -

function buildGraph(existingGraph, sourceLoops) {
  const mergedLoops = mergeLoops(existingGraph.feedbackLoops || [], sourceLoops);

  const result = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: existingGraph.title || 'Polychron Feedback Topology',
    description: existingGraph.description ||
      'A machine-readable map of the closed loops, firewalls, and emergence boundaries governing the polychron composition engine.',
    firewalls: existingGraph.firewalls || {},
    feedbackLoops: mergedLoops
  };
  // Preserve firewallPorts section if present (manually curated)
  if (existingGraph.firewallPorts) {
    result.firewallPorts = existingGraph.firewallPorts;
  }
  return result;
}

// -Main -

const sourceLoops = scanSourceLoops();
const existingGraph = loadExistingGraph();
const newGraph = buildGraph(existingGraph, sourceLoops);
const newJson = JSON.stringify(newGraph, null, 2) + '\n';

if (CHECK_MODE) {
  // Compare against existing (normalize line endings for cross-platform safety)
  const existingJson = fs.existsSync(GRAPH_PATH)
    ? fs.readFileSync(GRAPH_PATH, 'utf8').replace(/\r\n/g, '\n')
    : '';
  const normalizedNew = newJson.replace(/\r\n/g, '\n');

  if (normalizedNew === existingJson) {
    console.log(
      'generate-feedback-graph: OK (up to date, ' +
      newGraph.feedbackLoops.length + ' loops, ' +
      sourceLoops.size + ' from source)'
    );
  } else {
    console.error(
      'generate-feedback-graph: STALE - metrics/feedback_graph.json is out of date. ' +
      'Run: node scripts/generate-feedback-graph.js'
    );
    process.exit(1);
  }
} else {
  fs.writeFileSync(GRAPH_PATH, newJson);
  console.log(
    'generate-feedback-graph: wrote metrics/feedback_graph.json (' +
    newGraph.feedbackLoops.length + ' loops, ' +
    sourceLoops.size + ' from source, ' +
    newGraph.feedbackLoops.filter(l => l.conceptual).length + ' conceptual)'
  );
}
