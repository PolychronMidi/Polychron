#!/usr/bin/env node
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROXY_DIR = path.resolve(__dirname, '..', '..', 'proxy');
const BASELINE_FILE = path.resolve(__dirname, '..', 'fixtures', 'circular-baseline.txt');

function runMadge() {
  try {
    const out = execFileSync('npx', [
      '--yes', 'madge',
      '--circular',
      '--extensions', 'js',
      '--exclude', 'node_modules|tests|test',
      PROXY_DIR,
    ], {
      encoding: 'utf8',
      timeout: 120_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.stdout || out;
  } catch (err) {
    if (err.status !== 0 && err.stdout) {
      return err.stdout;
    }
    throw err;
  }
}

function parseCyclePaths(madgeOutput) {
  const paths = [];
  const lines = madgeOutput.split('\n');
  for (const line of lines) {
    const match = line.match(/^\d+\)\s+(.+)$/);
    if (match) {
      paths.push(match[1].trim());
    }
  }
  return paths.sort();
}

function main() {
  const output = runMadge();
  const current = parseCyclePaths(output);

  console.log(`Found ${current.length} circular dependenc${current.length === 1 ? 'y' : 'ies'}:`);
  for (const p of current) {
    console.log(`  ${p}`);
  }

  if (!fs.existsSync(BASELINE_FILE)) {
    console.log(`\nNo baseline at ${BASELINE_FILE} — writing current state as baseline.`);
    fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
    fs.writeFileSync(BASELINE_FILE, current.join('\n') + '\n');
    console.log('Baseline written. Re-run to verify.');
    process.exit(0);
  }

  const baseline = fs.readFileSync(BASELINE_FILE, 'utf8').trim().split('\n').filter(Boolean).sort();
  const added = current.filter((c) => !baseline.includes(c));
  const removed = baseline.filter((c) => !current.includes(c));

  if (added.length === 0 && removed.length === 0) {
    console.log('\nOK — cycles match baseline.');
    process.exit(0);
  }

  if (added.length > 0) {
    console.error(`\nFAIL: ${added.length} new circular dependenc${added.length === 1 ? 'y' : 'ies'} detected:`);
    for (const a of added) console.error(`  + ${a}`);
  }
  if (removed.length > 0) {
    console.log(`\n${removed.length} cycle(s) resolved (update baseline):`);
    for (const r of removed) console.log(`  - ${r}`);
  }

  if (added.length > 0) {
    console.error('\nFix the new cycles or, if benign (lazy requires), update the baseline:');
    console.error(`  cp tools/HME/tests/fixtures/circular-baseline.txt{,.bak} && node ${__filename}`);
    process.exit(1);
  }

  // Only removals — update baseline automatically.
  fs.writeFileSync(BASELINE_FILE, current.join('\n') + '\n');
  console.log('\nBaseline updated (only resolved cycles removed).');
  process.exit(0);
}

main();
