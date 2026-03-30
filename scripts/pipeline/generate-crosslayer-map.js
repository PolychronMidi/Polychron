// scripts/generate-crosslayer-map.js
// Auto-generates a cross-layer intelligence map showing module interactions,
// ATG channel usage, lifecycle scopes, and inter-module communication paths.
//
// Scans src/crossLayer/ source files to extract registration calls, ATG channel
// references, and inter-module dependency patterns. Produces both JSON and
// Markdown outputs for forensic and narrative use.
//
// Output: metrics/crosslayer-map.json, metrics/crosslayer-map.md
// Run: node scripts/generate-crosslayer-map.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const CL_DIR = path.join(ROOT, 'src', 'crossLayer');
const OUTPUT_DIR = path.join(ROOT, 'metrics');
const JSON_PATH  = path.join(OUTPUT_DIR, 'crosslayer-map.json');
const MD_PATH    = path.join(OUTPUT_DIR, 'crosslayer-map.md');

// -Helpers -

function walkJS(dir) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkJS(full));
    } else if (entry.name.endsWith('.js') && entry.name !== 'index.js') {
      results.push(full);
    }
  }
  return results;
}

function relPath(absPath) {
  return path.relative(path.join(ROOT, 'src'), absPath).replace(/\\/g, '/');
}

function subfolder(absPath) {
  const rel = path.relative(CL_DIR, absPath).replace(/\\/g, '/');
  const parts = rel.split('/');
  return parts.length > 1 ? parts[0] : '(top-level)';
}

// -Source Analysis -

function analyzeModule(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split(/\r?\n/);
  const name = path.basename(filePath, '.js');
  const folder = subfolder(filePath);

  // Extract description from top comment
  let description = '';
  for (const line of lines.slice(0, 10)) {
    const m = line.match(/^\/\/\s*(?:\S+\.js\s*-\s*)?(.+)/);
    if (m && !description) {
      const text = m[1].trim();
      if (text.length > 10) description = text;
    }
  }

  // Extract crossLayerRegistry.register() scopes
  const scopeMatch = src.match(/crossLayerRegistry\.register\([^,]+,\s*[^,]+,\s*\[([^\]]*)\]/);
  const scopes = scopeMatch
    ? scopeMatch[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean)
    : [];

  // Extract ATG channel references
  const atgChannels = new Set();
  const atgRe = /absoluteTimeGrid\.(post|query|subscribe|peek)\w*\(\s*['"]([^'"]+)['"]/g;
  let atgMatch;
  while ((atgMatch = atgRe.exec(src)) !== null) {
    atgChannels.add(atgMatch[2]);
  }
  // Also catch channel constants
  const channelConstRe = /(?:const|let|var)\s+\w*[Cc]hannel\w*\s*=\s*['"]([^'"]+)['"]/g;
  while ((atgMatch = channelConstRe.exec(src)) !== null) {
    atgChannels.add(atgMatch[1]);
  }
  const CHANNEL_RE = /CHANNEL\s*=\s*['"]([^'"]+)['"]/g;
  while ((atgMatch = CHANNEL_RE.exec(src)) !== null) {
    atgChannels.add(atgMatch[1]);
  }

  // Extract cross-layer module references (other modules this one calls)
  const interactions = new Set();
  const moduleNames = [
    'adaptiveTrustScores', 'cadenceAlignment', 'convergenceDetector', 'convergenceHarmonicTrigger',
    'crossLayerClimaxEngine', 'crossLayerDynamicEnvelope', 'crossLayerSilhouette',
    'dynamicRoleSwap', 'emergentDownbeat', 'entropyMetrics', 'entropyRegulator',
    'explainabilityBus', 'feedbackOscillator', 'grooveTransfer', 'harmonicIntervalGuard',
    'interactionHeatMap', 'motifEcho', 'motifIdentityMemory', 'negotiationEngine',
    'phaseAwareCadenceWindow', 'pitchMemoryRecall', 'polyrhythmicPhasePredictor',
    'registerCollisionAvoider', 'restSynchronizer', 'rhythmicComplementEngine',
    'rhythmicPhaseLock', 'sectionIntentCurves', 'spectralComplementarity',
    'stutterContagion', 'temporalGravity', 'texturalMirror', 'velocityInterference',
    'conductorSignalBridge', 'beatInterleavedProcessor', 'contextualTrust',
    'articulationComplement', 'verticalIntervalMonitor'
  ];
  for (const modName of moduleNames) {
    if (modName !== name && src.includes(modName)) {
      interactions.add(modName);
    }
  }

  // Detect if it uses conductorSignalBridge (reads conductor signals)
  const readsSignals = src.includes('conductorSignalBridge');

  // Detect if it writes to explainabilityBus
  const emitsExplain = src.includes('explainabilityBus.emit');

  // Detect feedbackRegistry enrollment
  const feedbackEnrolled = src.includes('feedbackRegistry');

  return {
    name,
    folder,
    path: relPath(filePath),
    description,
    scopes,
    atgChannels: [...atgChannels].sort(),
    interactions: [...interactions].sort(),
    readsSignals,
    emitsExplain,
    feedbackEnrolled
  };
}

// -Build Map -

function buildMap() {
  const files = walkJS(CL_DIR);
  const modules = files.map(analyzeModule);

  // Build ATG channel usage summary
  const atgUsage = {};
  for (const mod of modules) {
    for (const ch of mod.atgChannels) {
      if (!atgUsage[ch]) atgUsage[ch] = [];
      atgUsage[ch].push(mod.name);
    }
  }

  // Build interaction graph (edges)
  const edges = [];
  for (const mod of modules) {
    for (const target of mod.interactions) {
      edges.push({ from: mod.name, to: target });
    }
  }

  // Group by subfolder
  const byFolder = {};
  for (const mod of modules) {
    if (!byFolder[mod.folder]) byFolder[mod.folder] = [];
    byFolder[mod.folder].push(mod.name);
  }

  // Scope summary
  const scopeCounts = { all: 0, section: 0, phrase: 0, unregistered: 0 };
  for (const mod of modules) {
    if (mod.scopes.length === 0) { scopeCounts.unregistered++; continue; }
    for (const s of mod.scopes) {
      if (scopeCounts[s] !== undefined) scopeCounts[s]++;
    }
  }

  return {
    meta: {
      generated: new Date().toISOString(),
      moduleCount: modules.length,
      edgeCount: edges.length,
      atgChannelCount: Object.keys(atgUsage).length
    },
    modules,
    atgChannels: atgUsage,
    interactionEdges: edges,
    folderGroups: byFolder,
    scopeSummary: scopeCounts
  };
}

// -Markdown Rendering -

function renderMarkdown(map) {
  const lines = [];
  lines.push('# Cross-Layer Intelligence Map');
  lines.push('');
  lines.push('> Auto-generated by `scripts/generate-crosslayer-map.js`. Do not hand-edit.');
  lines.push('');
  lines.push(`**${map.meta.moduleCount}** modules | **${map.meta.edgeCount}** interaction edges | **${map.meta.atgChannelCount}** ATG channels`);
  lines.push('');

  // Folder groups
  lines.push('## Module Groups');
  lines.push('');
  const folderOrder = ['(top-level)', 'structure', 'harmony', 'rhythm', 'dynamics'];
  for (const folder of folderOrder) {
    const mods = map.folderGroups[folder];
    if (!mods) continue;
    lines.push(`### ${folder === '(top-level)' ? 'Top-Level' : folder.charAt(0).toUpperCase() + folder.slice(1)}`);
    lines.push('');
    lines.push('| Module | Scopes | ATG Channels | Reads Signals | Emits Explain |');
    lines.push('|--|--|-|||');
    for (const name of mods.sort()) {
      const mod = map.modules.find(m => m.name === name);
      if (!mod) continue;
      const scopes = mod.scopes.length > 0 ? mod.scopes.join(', ') : '(helper)';
      const atg = mod.atgChannels.length > 0 ? mod.atgChannels.join(', ') : '-';
      lines.push(`| ${name} | ${scopes} | ${atg} | ${mod.readsSignals ? 'Yes' : '-'} | ${mod.emitsExplain ? 'Yes' : '-'} |`);
    }
    lines.push('');
  }

  // ATG channel usage
  lines.push('## ATG Channel Usage');
  lines.push('');
  lines.push('| Channel | Modules |');
  lines.push('|||');
  for (const [ch, mods] of Object.entries(map.atgChannels).sort()) {
    lines.push(`| ${ch} | ${mods.join(', ')} |`);
  }
  lines.push('');

  // Scope summary
  lines.push('## Scope Summary');
  lines.push('');
  lines.push(`- **all**: ${map.scopeSummary.all} modules`);
  lines.push(`- **section**: ${map.scopeSummary.section} modules`);
  lines.push(`- **phrase**: ${map.scopeSummary.phrase} modules`);
  lines.push(`- **unregistered helpers**: ${map.scopeSummary.unregistered}`);
  lines.push('');

  // Top interaction hubs
  const hubCounts = {};
  for (const edge of map.interactionEdges) {
    hubCounts[edge.to] = (hubCounts[edge.to] || 0) + 1;
  }
  const topHubs = Object.entries(hubCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  lines.push('## Interaction Hubs (most referenced)');
  lines.push('');
  lines.push('| Module | Referenced By |');
  lines.push('|--|-|');
  for (const [name, count] of topHubs) {
    lines.push(`| ${name} | ${count} modules |`);
  }
  lines.push('');

  lines.push(`\n*Generated ${map.meta.generated}*`);
  return lines.join('\n');
}

// -Main -

function main() {
  const map = buildMap();
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(map, null, 2), 'utf8');
  fs.writeFileSync(MD_PATH, renderMarkdown(map), 'utf8');
  console.log(`crosslayer-map: ${map.meta.moduleCount} modules, ${map.meta.edgeCount} edges, ${map.meta.atgChannelCount} ATG channels -> metrics/crosslayer-map.json + .md`);
}

main();
