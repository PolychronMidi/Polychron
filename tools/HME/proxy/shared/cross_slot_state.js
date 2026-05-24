'use strict';

// Cross-slot shared state via filesystem IPC. Both proxy slots (a and b) read
// and write to the same files in runtime/shared/ so per-conversation dedup

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../shared');

const SHARED_DIR = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'shared');
const DEDUP_FILE = path.join(SHARED_DIR, 'processed-dedup.jsonl');
const RATELIMIT_FILE = path.join(SHARED_DIR, 'rate-limit-state.json');

function _ensureDir() {
  try { fs.mkdirSync(SHARED_DIR, { recursive: true }); } catch (_) { /* dir exists */ }
}

function appendDedupId(id) {
  if (!id) return;
  _ensureDir();
  try {
    fs.appendFileSync(DEDUP_FILE, JSON.stringify({ id: String(id), ts: Date.now() }) + '\n');
  } catch (_) { /* dedup file write best-effort; in-memory map still correct */ }
}

function loadDedupIds(maxAgeMs = 7 * 24 * 60 * 60 * 1000, cap = 100_000) {
  if (!fs.existsSync(DEDUP_FILE)) return new Map();
  const out = new Map();
  const now = Date.now();
  try {
    const lines = fs.readFileSync(DEDUP_FILE, 'utf8').split('\n');
    for (const line of lines) {
      if (!line) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (_) { continue; }
      if (!rec || !rec.id || typeof rec.ts !== 'number') continue;
      if (now - rec.ts > maxAgeMs) continue;
      out.set(String(rec.id), rec.ts);
    }
  } catch (_) { /* unreadable; start clean */ }
  if (out.size <= cap) return out;
  const sorted = [...out.entries()].sort((a, b) => b[1] - a[1]).slice(0, cap);
  return new Map(sorted);
}

function compactDedupFile(maxAgeMs = 7 * 24 * 60 * 60 * 1000, cap = 100_000) {
  if (!fs.existsSync(DEDUP_FILE)) return;
  const live = loadDedupIds(maxAgeMs, cap);
  const tmp = DEDUP_FILE + '.compact.tmp';
  try {
    const lines = [...live.entries()].map(([id, ts]) => JSON.stringify({ id, ts })).join('\n');
    fs.writeFileSync(tmp, lines ? lines + '\n' : '');
    fs.renameSync(tmp, DEDUP_FILE);
  } catch (_) { try { fs.unlinkSync(tmp); } catch (_) { /* tmp already gone */ } }
}

function readRateLimitState() {
  if (!fs.existsSync(RATELIMIT_FILE)) return { consecutive_429s: 0, last_429_ts: 0, last_slot: null };
  try { return JSON.parse(fs.readFileSync(RATELIMIT_FILE, 'utf8')); } catch (_) { return { consecutive_429s: 0, last_429_ts: 0, last_slot: null }; }
}

function writeRateLimitState(state) {
  _ensureDir();
  const payload = {
    consecutive_429s: Number(state.consecutive_429s || 0),
    last_429_ts: Number(state.last_429_ts || 0),
    last_slot: state.last_slot || null,
  };
  try {
    const tmp = RATELIMIT_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, RATELIMIT_FILE);
  } catch (_) { /* rate-limit file write best-effort */ }
}

module.exports = {
  appendDedupId,
  loadDedupIds,
  compactDedupFile,
  readRateLimitState,
  writeRateLimitState,
  paths: { DEDUP_FILE, RATELIMIT_FILE, SHARED_DIR },
};
