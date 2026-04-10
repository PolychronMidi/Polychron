#!/usr/bin/env node
// One-time migration: remove safePreBoot wrappers for 5 globals that never throw.
// These globals are boot-validated with safe public APIs -- the wrappers are
// unnecessary defensive code that violates the fail-fast principle.
'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SRC  = path.join(ROOT, 'src');

const TARGETS = [
  'emergentMelodicEngine',
  'hyperMetaManager',
  'regimeClassifier',
  'systemDynamicsProfiler',
  'pipelineCouplingManager',
];

function findJsFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findJsFiles(full));
    else if (entry.name.endsWith('.js')) results.push(full);
  }
  return results;
}

function unwrapSafePreBoot(source, target) {
  const marker = `safePreBoot.call(() => ${target}.`;
  let result = source;
  let changed = 0;

  while (true) {
    const idx = result.indexOf(marker);
    if (idx === -1) break;

    // Find the start of safePreBoot.call(
    const callStart = idx;
    const openParen = result.indexOf('(', callStart + 'safePreBoot.call'.length);
    if (openParen === -1) break;

    // Find matching close paren for the outer call
    let depth = 1;
    let pos = openParen + 1;
    while (depth > 0 && pos < result.length) {
      const ch = result[pos];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') depth--;
      pos++;
    }
    const callEnd = pos;
    const fullExpr = result.slice(callStart, callEnd);

    // Find '() => ' inside the expression
    const arrowIdx = fullExpr.indexOf('() => ');
    if (arrowIdx === -1) break;
    const bodyStart = arrowIdx + 6;

    // Find the separator comma at depth 0 (separates lambda body from fallback)
    let sepComma = -1;
    depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    for (let i = bodyStart; i < fullExpr.length - 1; i++) {
      const ch = fullExpr[i];
      if (ch === "'" && !inDoubleQuote) inSingleQuote = !inSingleQuote;
      if (ch === '"' && !inSingleQuote) inDoubleQuote = !inDoubleQuote;
      if (inSingleQuote || inDoubleQuote) continue;
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (depth < 0) break;
      if (ch === ',' && depth === 0) { sepComma = i; break; }
    }

    if (sepComma === -1) break;

    const lambdaBody = fullExpr.slice(bodyStart, sepComma).trim();
    result = result.slice(0, callStart) + lambdaBody + result.slice(callEnd);
    changed++;
  }

  return { result, changed };
}

// Run migration
const allFiles = findJsFiles(SRC);
let totalChanged = 0;
let filesChanged = 0;

for (const filePath of allFiles) {
  const original = fs.readFileSync(filePath, 'utf8');
  let current = original;

  for (const target of TARGETS) {
    if (!current.includes(`safePreBoot.call(() => ${target}.`)) continue;
    const { result, changed } = unwrapSafePreBoot(current, target);
    current = result;
    totalChanged += changed;
  }

  if (current !== original) {
    fs.writeFileSync(filePath, current);
    filesChanged++;
    const rel = path.relative(ROOT, filePath);
    console.log(`  ${rel}`);
  }
}

console.log(`\nUnwrapped ${totalChanged} safePreBoot calls across ${filesChanged} files.`);
console.log('Run: npm run lint && npm run tc  to verify.');
