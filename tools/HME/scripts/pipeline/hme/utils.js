// Shared utilities for HME pipeline steps.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Load JSON from an absolute or project-relative path. Returns null on missing/malformed.
 */
function loadJson(p) {
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!fs.existsSync(abs)) return null;
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (_e) {
    return null;
  }
}

/**
 * Load JSONL (one JSON object per line). Returns array. Skips malformed lines.
 * @param {string} p - absolute or project-relative path
 * @param {number} [tail] - only read last N lines (default: all)
 */
function loadJsonl(p, tail) {
  const abs = path.isAbsolute(p) ? p : path.join(ROOT, p);
  if (!fs.existsSync(abs)) return [];
  try {
    let lines = fs.readFileSync(abs, 'utf8').split('\n').filter(Boolean);
    if (tail && tail > 0) lines = lines.slice(-tail);
    return lines.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_e) {
    return [];
  }
}

/**
 * Write JSON to a project-relative path, creating directories as needed.
 */
function writeJson(relPath, data) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(data, null, 2));
}

/**
 * Clamp a number to [lo, hi].
 */
function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = { ROOT, loadJson, loadJsonl, writeJson, clamp };
