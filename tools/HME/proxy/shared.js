'use strict';
// Shared primitives: activity emission, session identity, path constants.

const { spawn } = require('child_process');
const path = require('path');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const EMIT_PY = path.join(PROJECT_ROOT, 'tools/HME/activity/emit.py');

function emit(fields) {
  try {
    const args = [EMIT_PY];
    for (const [k, v] of Object.entries(fields)) {
      args.push(`--${k}=${v}`);
    }
    const p = spawn('python3', args, { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch (_err) {
    // ignore
  }
}

function shortHash(s) {
  let h = 0;
  const n = Math.min(s.length, 500);
  for (let i = 0; i < n; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function sessionKey(payload) {
  const msgs = payload && payload.messages;
  if (!Array.isArray(msgs)) return 'unknown';
  for (const m of msgs) {
    if (m && m.role === 'user') {
      const c = m.content;
      const s = typeof c === 'string' ? c : JSON.stringify(c || '');
      return shortHash(s);
    }
  }
  return 'unknown';
}

module.exports = { emit, shortHash, sessionKey, PROJECT_ROOT, EMIT_PY };
