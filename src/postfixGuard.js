// postfixGuard.js - centralized critical-only enforcement utilities
const fs = require('fs');
const path = require('path');
const { writeFatal } = require('./logGate');

function _ensureOutDir() {
  try {
    const outDir = path.join(process.cwd(), 'output', 'diagnostics');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    return outDir;
  } catch (e) { return path.join(process.cwd(), 'output'); }
}

function raiseCritical(key, msg, ctx = {}) {
  try {
    const outDir = _ensureOutDir();
    const payload = Object.assign({ when: new Date().toISOString(), type: 'postfix-anti-pattern', severity: 'critical', key, msg, stack: (new Error()).stack }, ctx);
    // Include optional play-run identifier from environment so callers can correlate CRITICALs to a specific play run
    try {
      if (process && process.env && process.env.PLAY_RUN_ID) payload.playRunId = process.env.PLAY_RUN_ID;
    } catch (e) { /* swallow */ }
    try {
      // Append a JSON line to a diagnostics ndjson file for later inspection
      const file = path.join(outDir, 'postfix-failures.ndjson');
      fs.appendFileSync(file, JSON.stringify(payload) + '\n', 'utf8');
    } catch (e) { /* swallow */ }
    try { writeFatal(payload); } catch (e) { /* swallow */ }
  } catch (e) { /* swallow */ }
  throw new Error('CRITICAL: ' + msg);
}

module.exports = { raiseCritical };
