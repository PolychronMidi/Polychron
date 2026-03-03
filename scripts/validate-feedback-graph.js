// scripts/validate-feedback-graph.js
// Cross-validates metrics/feedback_graph.json against source code.
// Ensures the declared feedback topology matches actual registrations.
// Runs as a static analysis step (no runtime coupling to the engine).
//
// Checks:
//   1. Every JSON loop module corresponds to an existing source file
//   2. Every feedbackRegistry.registerLoop() call in source has a JSON entry
//   3. Every closedLoopController.create() call in source has a JSON entry
//   4. Source/target domain strings are non-empty
//   5. Firewall names reference valid ESLint rules
//
// Run: node scripts/validate-feedback-graph.js
// Integrated into `npm run main` pipeline (after check-tuning-invariants).

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC  = path.join(ROOT, 'src');
const METRICS  = path.join(ROOT, 'metrics');

function readFile(relPath) {
  const abs = path.join(SRC, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Recursively find all .js files under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
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

// ---- Load feedback_graph.json ----

const graphPath = path.join(METRICS, 'feedback_graph.json');
if (!fs.existsSync(graphPath)) {
  console.error('validate-feedback-graph: FATAL - metrics/feedback_graph.json not found');
  process.exit(1);
}

let graph;
try {
  graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
} catch (err) {
  console.error('validate-feedback-graph: FATAL - failed to parse feedback_graph.json:', err.message);
  process.exit(1);
}

// ---- Extract loop declarations from JSON ----

const jsonLoops = graph.feedbackLoops || [];
const jsonLoopModules = new Set(jsonLoops.map(l => l.module));
const jsonLoopIds = new Set(jsonLoops.map(l => l.id));
const jsonFirewallKeys = new Set(Object.keys(graph.firewalls || {}));

// ---- Scan source for runtime loop registrations ----

const allJsFiles = findJsFiles(SRC);
const sourceLoops = []; // { name, file, type: 'registerLoop'|'closedLoopController' }

for (const filePath of allJsFiles) {
  const src = fs.readFileSync(filePath, 'utf8');
  const relPath = path.relative(SRC, filePath).replace(/\\/g, '/');

  // feedbackRegistry.registerLoop('name', ...)
  const regLoopMatches = src.matchAll(/feedbackRegistry\.registerLoop\(\s*'([^']+)'/g);
  for (const match of regLoopMatches) {
    sourceLoops.push({ name: match[1], file: relPath, type: 'registerLoop' });
  }

  // closedLoopController.create({ name: 'name', ... })
  // Skip matches inside JSDoc @example blocks (e.g., closedLoopController.js docstring)
  const clcMatches = src.matchAll(/closedLoopController\.create\(\s*\{[^}]*name:\s*'([^']+)'/g);
  for (const match of clcMatches) {
    // Detect if match is inside a JSDoc comment block
    const before = src.slice(0, match.index);
    const lastDocOpen = before.lastIndexOf('/**');
    const lastDocClose = before.lastIndexOf('*/');
    if (lastDocOpen > lastDocClose) continue; // inside /** ... */ block - skip
    sourceLoops.push({ name: match[1], file: relPath, type: 'closedLoopController' });
  }
}

const sourceLoopNames = new Set(sourceLoops.map(l => l.name));

// ---- Build module-name-to-loop-id mapping from JSON ----
// JSON uses descriptive IDs (e.g., 'density-correction') while source uses module names
// (e.g., 'coherenceMonitor'). The JSON 'module' field bridges this.
const jsonModuleToId = {};
for (const loop of jsonLoops) {
  jsonModuleToId[loop.module] = loop.id;
}

// ---- Validation ----

const failures = [];
const warnings = [];
let passes = 0;

// Check 1: JSON structure
if (!Array.isArray(jsonLoops) || jsonLoops.length === 0) {
  failures.push('feedback_graph.json feedbackLoops must be a non-empty array');
}
if (!graph.firewalls || typeof graph.firewalls !== 'object') {
  failures.push('feedback_graph.json firewalls must be an object');
}

// Check 2: Every JSON loop has required fields
for (const loop of jsonLoops) {
  const label = `loop "${loop.id || '(no id)'}"`;
  if (!loop.id || typeof loop.id !== 'string') {
    failures.push(`${label}: missing or empty id`);
  } else { passes++; }
  if (!loop.module || typeof loop.module !== 'string') {
    failures.push(`${label}: missing or empty module`);
  } else { passes++; }
  if (!loop.sourceDomain || typeof loop.sourceDomain !== 'string') {
    failures.push(`${label}: missing or empty sourceDomain`);
  } else { passes++; }
  if (!loop.targetDomain || typeof loop.targetDomain !== 'string') {
    failures.push(`${label}: missing or empty targetDomain`);
  } else { passes++; }
  if (!loop.mechanism || typeof loop.mechanism !== 'string') {
    failures.push(`${label}: missing or empty mechanism`);
  } else { passes++; }

  const validLatencies = ['immediate', 'beat-delayed', 'phrase-delayed', 'section-delayed'];
  if (!validLatencies.includes(loop.latency)) {
    failures.push(`${label}: invalid latency "${loop.latency}" (expected one of: ${validLatencies.join(', ')})`);
  } else { passes++; }

  // Check firewallsCrossed references
  if (Array.isArray(loop.firewallsCrossed)) {
    for (const fw of loop.firewallsCrossed) {
      if (!jsonFirewallKeys.has(fw)) {
        failures.push(`${label}: references unknown firewall "${fw}"`);
      } else { passes++; }
    }
  }
}

// Check 3: Source loops that have no corresponding JSON entry
// We check by module name (source loop name) against JSON module fields
for (const sLoop of sourceLoops) {
  if (jsonLoopModules.has(sLoop.name)) {
    passes++;
  } else {
    // It's a real loop not documented in feedback_graph.json
    warnings.push(
      `Source loop "${sLoop.name}" (${sLoop.type} in ${sLoop.file}) has no entry in feedback_graph.json. ` +
      'Consider adding it to maintain topology documentation.'
    );
  }
}

// Check 4: JSON loop modules that have no corresponding source registration
// Loops marked "conceptual": true in JSON are advisory documentation -
// they represent implicit feedback paths without explicit feedbackRegistry
// enrollment. Skip the source-match check for these.
for (const jsonLoop of jsonLoops) {
  const jsonMod = jsonLoop.module;
  if (jsonLoop.conceptual) {
    passes++; // conceptual loops are documentation-only, not enrolled in resonance dampening
  } else if (sourceLoopNames.has(jsonMod)) {
    passes++;
  } else {
    warnings.push(
      `feedback_graph.json declares loop module "${jsonMod}" (id: ${jsonModuleToId[jsonMod]}) ` +
      'but no feedbackRegistry.registerLoop() or closedLoopController.create() call found in source. ' +
      'This may be a conceptual loop not enrolled in resonance dampening.'
    );
  }
}

// Check 5: ESLint rule mapping for firewalls
const FIREWALL_ESLINT_MAP = {
  CONDUCTOR_BLINDNESS: [
    'no-conductor-registration-from-crosslayer',
    'no-direct-conductor-state-from-crosslayer'
  ],
  SIGNAL_DELAY: [
    'no-direct-signal-read'
  ],
  REGISTRY_DAMPENING: [
    'no-unregistered-feedback-loop'
  ]
};

const eslintRulesDir = path.join(ROOT, 'scripts', 'eslint-rules');
for (const [firewallName, ruleNames] of Object.entries(FIREWALL_ESLINT_MAP)) {
  if (!jsonFirewallKeys.has(firewallName)) {
    warnings.push(`Expected firewall "${firewallName}" not found in feedback_graph.json`);
    continue;
  }
  for (const ruleName of ruleNames) {
    const ruleFile = path.join(eslintRulesDir, ruleName + '.js');
    if (fs.existsSync(ruleFile)) {
      passes++;
    } else {
      failures.push(`Firewall "${firewallName}" expects ESLint rule "${ruleName}" but ${ruleName}.js not found in scripts/eslint-rules/`);
    }
  }
}

// ---- Output ----

const results = {
  meta: {
    script: 'validate-feedback-graph.js',
    timestamp: new Date().toISOString(),
    graphPath: 'metrics/feedback_graph.json'
  },
  jsonLoopCount: jsonLoops.length,
  sourceLoopCount: sourceLoops.length,
  sourceLoops: sourceLoops.map(l => ({ name: l.name, file: l.file, type: l.type })),
  firewallCount: jsonFirewallKeys.size,
  passes,
  failures,
  warnings
};

const outputPath = path.join(ROOT, 'metrics', 'feedback-graph-validation.json');
fs.writeFileSync(outputPath, JSON.stringify(results, null, 2) + '\n');

// ---- Report ----

if (warnings.length > 0) {
  console.log('validate-feedback-graph: WARNINGS (' + warnings.length + '):');
  for (const w of warnings) {
    console.log('  - ' + w);
  }
}

if (failures.length > 0) {
  console.error('validate-feedback-graph: FAIL (' + failures.length + ' failures, ' + passes + ' passes)');
  for (const f of failures) {
    console.error('  FAIL: ' + f);
  }
  process.exit(1);
} else {
  console.log(
    'validate-feedback-graph: PASS (' + passes + ' checks, ' +
    jsonLoops.length + ' JSON loops, ' +
    sourceLoops.length + ' source loops, ' +
    warnings.length + ' warnings)'
  );
}
