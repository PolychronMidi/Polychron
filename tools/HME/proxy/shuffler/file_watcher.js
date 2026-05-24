#!/usr/bin/env node
'use strict';

// Watches tools/HME/proxy/** for changes and triggers per-slot restart via
// polychron-slot-restart.sh, alternating slots so at least one always serves.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { loadEnv, requireEnv } = require('../shared/load_env');

loadEnv(path.resolve(__dirname, '..', '..', '..', '..', '.env'));

const PROJECT_ROOT = requireEnv('PROJECT_ROOT');
const WATCH_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'proxy');
const SLOT_SCRIPT = path.join(PROJECT_ROOT, 'tools', 'HME', 'launcher', 'polychron-slot-restart.sh');
const DEBOUNCE_MS = 5000;
const SHUFFLER_OWN_DIR = path.join(WATCH_DIR, 'shuffler');

const SKIP_PATTERNS = [
  /node_modules\//,
  /\.tmp$/,
  /\.swp$/,
  /\.swo$/,
  /~$/,
  /\.health$/,
  /\.flag$/,
  /\/runtime\//,
];

let pendingTimer = null;
let nextSlot = 'a';
let inFlightRestart = false;

function shouldRestart(filePath) {
  if (!filePath) return false;
  if (filePath.startsWith(SHUFFLER_OWN_DIR)) return false;
  for (const re of SKIP_PATTERNS) if (re.test(filePath)) return false;
  if (!/\.(js|mjs|cjs|json)$/.test(filePath)) return false;
  return true;
}

function scheduleRestart(filePath) {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    runRestart(filePath);
  }, DEBOUNCE_MS);
}

function runRestart(triggerPath) {
  if (inFlightRestart) {
    console.error(`[file-watcher] restart already in-flight; deferring trigger from ${path.relative(PROJECT_ROOT, triggerPath)}`);
    return;
  }
  inFlightRestart = true;
  const slot = nextSlot;
  nextSlot = slot === 'a' ? 'b' : 'a';
  console.error(`[file-watcher] proxy change detected (${path.relative(PROJECT_ROOT, triggerPath)}); restarting slot ${slot}`);
  const proc = spawn('bash', [SLOT_SCRIPT, '--slot', slot], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  proc.on('exit', (code) => {
    inFlightRestart = false;
    if (code !== 0) console.error(`[file-watcher] slot-restart ${slot} exited ${code}; check log/hme-proxy-${slot}.out`);
  });
}

function walkRegister(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p.startsWith(SHUFFLER_OWN_DIR)) continue;
      if (/node_modules|\/runtime\//.test(p)) continue;
      walkRegister(p);
    }
  }
}

function start() {
  if (!fs.existsSync(WATCH_DIR)) {
    console.error(`[file-watcher] watch dir missing: ${WATCH_DIR}`);
    process.exit(1);
  }
  walkRegister(WATCH_DIR);
  const watcher = fs.watch(WATCH_DIR, { recursive: true, persistent: true }, (_event, filename) => {
    if (!filename) return;
    const fullPath = path.join(WATCH_DIR, filename);
    if (!shouldRestart(fullPath)) return;
    scheduleRestart(fullPath);
  });
  watcher.on('error', (err) => {
    console.error(`[file-watcher] watcher error: ${err.message}`);
    process.exit(1);
  });
  console.error(`[file-watcher] watching ${WATCH_DIR} (debounce ${DEBOUNCE_MS}ms, alternating slots a/b)`);
  process.on('SIGTERM', () => { watcher.close(); process.exit(0); });
  process.on('SIGINT', () => { watcher.close(); process.exit(0); });
}

start();
