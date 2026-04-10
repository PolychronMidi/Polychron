#!/usr/bin/env node
// One-time migration: add conductorIntelligence.registerModule() to 44 conductor
// modules that have functional registrations (registerDensityBias, etc.) but no
// lifecycle registration. Without registerModule, state persists across section
// boundaries causing coherence decay.
//
// For each orphan module:
// 1. Add a no-op reset() function (pure-query modules have no state to reset)
// 2. Add conductorIntelligence.registerModule(name, { reset }, ['section'])
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

const FUNCTIONAL_PATTERNS = [
  'conductorIntelligence.registerDensityBias',
  'conductorIntelligence.registerTensionBias',
  'conductorIntelligence.registerFlickerModifier',
  'conductorIntelligence.registerRecorder',
  'conductorIntelligence.registerStateProvider',
];

// Exclude crossLayer modules -- they use crossLayerRegistry, not conductorIntelligence
const EXCLUDE = [
  'src/crossLayer/conductorSignalBridge.js',
];

function findJsFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

function getModuleName(filePath) {
  return path.basename(filePath, '.js');
}

const srcDir = path.join(ROOT, 'src');
const allFiles = findJsFiles(srcDir);
let migrated = 0;

for (const filePath of allFiles) {
  const rel = path.relative(ROOT, filePath).replace(/\\/g, '/');
  if (EXCLUDE.includes(rel)) continue;

  const src = fs.readFileSync(filePath, 'utf8');

  // Check: has functional registrations?
  const hasFunctional = FUNCTIONAL_PATTERNS.some(p => src.includes(p));
  if (!hasFunctional) continue;

  // Check: already has registerModule?
  if (src.includes('conductorIntelligence.registerModule(')) continue;

  const moduleName = getModuleName(filePath);

  // Check: already has a reset function?
  const hasReset = /function reset\s*\(/.test(src) || /(?:const|let|var)\s+reset\s*=/.test(src);

  // Find the last conductorIntelligence.register* call (line-based)
  const lines = src.split('\n');
  let lastRegIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (FUNCTIONAL_PATTERNS.some(p => lines[i].includes(p))) {
      // Walk forward to find the end of this call (might be multi-line)
      let depth = 0;
      let j = i;
      let found = false;
      for (; j < lines.length; j++) {
        for (const ch of lines[j]) {
          if (ch === '(') depth++;
          if (ch === ')') { depth--; if (depth === 0) { found = true; break; } }
        }
        if (found) break;
      }
      lastRegIdx = j;
    }
  }

  if (lastRegIdx === -1) continue;

  // Build the injection
  const indent = '  '; // standard 2-space indent
  const injection = [];
  if (!hasReset) {
    injection.push('');
    injection.push(`${indent}function reset() {}`);
  }
  injection.push(`${indent}conductorIntelligence.registerModule('${moduleName}', { reset }, ['section']);`);

  // Insert after the last registration call
  lines.splice(lastRegIdx + 1, 0, ...injection);

  fs.writeFileSync(filePath, lines.join('\n'));
  migrated++;
  console.log(`  ${rel} -- added registerModule`);
}

console.log(`\nMigrated ${migrated} modules.`);
console.log('Run: npm run lint && npm run tc  to verify.');
