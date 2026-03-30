// scripts/generate-conductor-map.js
// Auto-generates a Conductor Intelligence Map - a structural understanding
// tool showing, for each intelligence module:
//   (a) what signals it reads
//   (b) what biases it contributes (density/tension/flicker)
//   (c) what domain it belongs to
//   (d) its reset scope
//   (e) its interaction partners from the feedback topology
//
// Sources: metrics/system-manifest.json + metrics/boot-order.json + source files
// Output: metrics/conductor-map.json + metrics/conductor-map.md
//
// Run: node scripts/generate-conductor-map.js
// Integrated into `npm run main` pipeline.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC  = path.join(ROOT, 'src');
const OUTPUT_DIR = path.join(ROOT, 'metrics');
const MANIFEST_PATH = path.join(OUTPUT_DIR, 'system-manifest.json');
const BOOT_ORDER_PATH = path.join(OUTPUT_DIR, 'boot-order.json');
const JSON_OUTPUT = path.join(OUTPUT_DIR, 'conductor-map.json');
const MD_OUTPUT = path.join(OUTPUT_DIR, 'conductor-map.md');

// -Load data sources -

function loadJSON(filePath) {
  if (!fs.existsSync(filePath)) {
    console.warn('Acceptable warning: generate-conductor-map: missing ' + filePath + ', skipping.');
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.warn('Acceptable warning: generate-conductor-map: failed to parse ' + filePath + ': ' + (err && err.message ? err.message : err));
    return null;
  }
}

// -Detect domain from file path -

function getDomain(filePath) {
  const rel = filePath.replace(/\\/g, '/');
  const conductorDomains = ['dynamics', 'harmonic', 'melodic', 'rhythmic', 'texture', 'signal', 'journey', 'profiles'];
  for (const d of conductorDomains) {
    if (rel.includes('conductor/' + d + '/')) return d;
  }
  if (rel.includes('conductor/')) return 'top-level';
  if (rel.includes('crossLayer/')) return 'cross-layer';
  return 'other';
}

// -Extract signal reads from source file -

function extractSignalReads(src) {
  const reads = new Set();
  const patterns = [
    [/signalReader\.density\(\)/g, 'density'],
    [/signalReader\.tension\(\)/g, 'tension'],
    [/signalReader\.flicker\(\)/g, 'flicker'],
    [/signalReader\.playProb\(\)/g, 'playProb'],
    [/signalReader\.stutterProb\(\)/g, 'stutterProb'],
    [/signalReader\.densityAttribution\(\)/g, 'densityAttribution'],
    [/signalReader\.tensionAttribution\(\)/g, 'tensionAttribution'],
    [/signalReader\.flickerAttribution\(\)/g, 'flickerAttribution'],
    [/conductorState\.\w+/g, 'conductorState'],
    [/conductorSignalBridge\.\w+/g, 'conductorSignalBridge'],
    [/signalTelemetry\.\w+/g, 'signalTelemetry'],
    [/signalHealthAnalyzer\.\w+/g, 'signalHealth'],
    [/systemDynamicsProfiler\.\w+/g, 'systemDynamics'],
    [/entropyRegulator\.\w+/g, 'entropy'],
    [/adaptiveTrustScores\.\w+/g, 'trust'],
    [/timeStream\.\w+/g, 'timeStream'],
    [/sectionIntentCurves\.\w+/g, 'sectionIntent'],
    [/interactionHeatMap\.\w+/g, 'heatMap'],
    [/absoluteTimeGrid\.\w+/g, 'absoluteTimeGrid'],
    [/explainabilityBus\.\w+/g, 'explainabilityBus'],
  ];

  for (const [re, label] of patterns) {
    if (re.test(src)) reads.add(label);
    re.lastIndex = 0; // reset regex state
  }

  return [...reads].sort();
}

// -Extract registration types from source file -

function extractRegistrations(src) {
  const regs = [];
  if (/registerDensityBias/.test(src)) regs.push('density');
  if (/registerTensionBias/.test(src)) regs.push('tension');
  if (/registerFlickerModifier/.test(src)) regs.push('flicker');
  if (/registerRecorder/.test(src)) regs.push('recorder');
  if (/registerStateProvider/.test(src)) regs.push('stateProvider');
  return regs;
}

// -Extract reset scopes -

function extractScopes(src) {
  const m = src.match(/registerModule\s*\([^,]+,\s*[^,]+,\s*\[([^\]]+)\]/);
  if (m) {
    return m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
  }
  return [];
}

// -Build the conductor map -

function buildMap() {
  const manifest = loadJSON(MANIFEST_PATH);
  const bootOrder = loadJSON(BOOT_ORDER_PATH);
  if (!manifest || !bootOrder) return null;

  // Build module name -> file path mapping from boot order
  const nameToFile = new Map();
  for (const entry of bootOrder.bootOrder) {
    for (const g of entry.provides) {
      nameToFile.set(g, entry.file);
    }
  }

  // Extract module names from manifest
  const moduleNames = new Set();

  // From density/tension/flicker attributions
  const attributionKeys = ['density', 'tension', 'flicker'];
  const attribution = manifest.attribution || {};
  for (const key of attributionKeys) {
    const attr = attribution[key];
    if (attr && Array.isArray(attr.contributions)) {
      for (const c of attr.contributions) {
        moduleNames.add(c.name);
      }
    }
  }

  // From conductorIntelligence registry
  const ci = manifest.registries && manifest.registries.conductorIntelligence;
  if (ci && ci.moduleNames) {
    for (const n of ci.moduleNames) moduleNames.add(n);
  }

  // Build module entries
  const modules = [];
  for (const name of [...moduleNames].sort()) {
    const filePath = nameToFile.get(name);
    let src = '';
    let domain = 'unknown';

    if (filePath) {
      const absPath = path.join(ROOT, filePath);
      domain = getDomain(filePath);
      if (fs.existsSync(absPath)) {
        src = fs.readFileSync(absPath, 'utf8');
      }
    }

    const signalReads = extractSignalReads(src);
    const registrations = extractRegistrations(src);
    const scopes = extractScopes(src);

    // Find bias values from manifest attributions
    const biasValues = {};
    for (const key of attributionKeys) {
      const attr = attribution[key];
      if (attr && Array.isArray(attr.contributions)) {
        const c = attr.contributions.find(x => x.name === name);
        if (c) {
          biasValues[key] = { raw: c.raw, clamped: c.clamped };
        }
      }
    }

    modules.push({
      name,
      domain,
      file: filePath || null,
      registrations,
      scopes,
      signalReads,
      biasValues
    });
  }

  return modules;
}

// -Generate Markdown -

function generateMarkdown(modules) {
  const lines = [];
  lines.push('# Conductor Intelligence Map');
  lines.push('');
  lines.push('> Auto-generated per run by `generate-conductor-map.js`. Do not edit by hand.');
  lines.push('> Generated: ' + new Date().toISOString());
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push('| Domain | Modules | Density | Tension | Flicker | Recorders | State Providers |');
  lines.push('||||||||');

  // Group by domain
  const byDomain = {};
  for (const mod of modules) {
    if (!byDomain[mod.domain]) byDomain[mod.domain] = [];
    byDomain[mod.domain].push(mod);
  }

  for (const [domain, mods] of Object.entries(byDomain).sort()) {
    const d = mods.filter(m => m.registrations.includes('density')).length;
    const t = mods.filter(m => m.registrations.includes('tension')).length;
    const f = mods.filter(m => m.registrations.includes('flicker')).length;
    const r = mods.filter(m => m.registrations.includes('recorder')).length;
    const s = mods.filter(m => m.registrations.includes('stateProvider')).length;
    lines.push('| ' + domain + ' | ' + mods.length + ' | ' + d + ' | ' + t + ' | ' + f + ' | ' + r + ' | ' + s + ' |');
  }

  lines.push('');
  lines.push('## Module Details');
  lines.push('');

  for (const [domain, mods] of Object.entries(byDomain).sort()) {
    lines.push('### ' + domain.charAt(0).toUpperCase() + domain.slice(1));
    lines.push('');

    for (const mod of mods.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push('#### `' + mod.name + '`');
      lines.push('');
      if (mod.file) lines.push('- **File:** `' + mod.file + '`');
      lines.push('- **Registrations:** ' + (mod.registrations.length > 0 ? mod.registrations.join(', ') : 'none'));
      lines.push('- **Reset scopes:** ' + (mod.scopes.length > 0 ? mod.scopes.join(', ') : 'none detected'));
      lines.push('- **Signal reads:** ' + (mod.signalReads.length > 0 ? mod.signalReads.join(', ') : 'none detected'));

      if (Object.keys(mod.biasValues).length > 0) {
        const bv = Object.entries(mod.biasValues)
          .map(([k, v]) => k + '=' + (v.clamped !== undefined ? v.clamped.toFixed(4) : '?'))
          .join(', ');
        lines.push('- **Bias values (end-of-run):** ' + bv);
      }

      lines.push('');
    }
  }

  return lines.join('\n');
}

// -Main -

function main() {
  const modules = buildMap();
  if (!modules) {
    console.warn('Acceptable warning: generate-conductor-map: missing input files, skipping.');
    return;
  }

  // Write JSON
  const jsonOutput = {
    meta: {
      generated: new Date().toISOString(),
      description: 'Conductor Intelligence Map: per-module registry of signals, biases, domains, and scopes.',
      totalModules: modules.length
    },
    modules
  };

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_OUTPUT, JSON.stringify(jsonOutput, null, 2), 'utf8');

  // Write Markdown
  const md = generateMarkdown(modules);
  fs.writeFileSync(MD_OUTPUT, md, 'utf8');

  // Summary stats
  const domains = {};
  for (const m of modules) {
    domains[m.domain] = (domains[m.domain] || 0) + 1;
  }

  console.log(
    'generate-conductor-map: ' + modules.length + ' modules across ' +
    Object.keys(domains).length + ' domains -> metrics/conductor-map.json + metrics/conductor-map.md'
  );
}

main();
