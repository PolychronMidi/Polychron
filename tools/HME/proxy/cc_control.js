'use strict';

// Proxy-side submitter for local-session shortcut tokens. The PTY bridge
// (tools/HME/scripts/hme-claude.py) reads tmp/hme-cc-control.fifo and replays

const fs = require('fs');
const path = require('path');

function ccControlFifo(root) {
  return path.join(root || process.cwd(), 'tmp', 'hme-cc-control.fifo');
}

// Write a shortcut token to the cc-control FIFO. Non-blocking O_WRONLY: when no
// PTY bridge is attached the open fails with ENXIO (no reader) or ENOENT (no
function submitCcShortcut(root, key = 'cc', prompt = '') {
  const fifo = ccControlFifo(root);
  let fd;
  try {
    fd = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
  } catch (err) {
    if (err && (err.code === 'ENXIO' || err.code === 'ENOENT')) return false;
    // Any other open error (EACCES, etc.) is unexpected: surface it to the
    // caller's log rather than masquerade as "bridge absent".
    throw err;
  }
  const suffix = prompt ? `\t${Buffer.from(String(prompt), 'utf8').toString('base64')}` : '';
  try {
    fs.writeSync(fd, `${key}${suffix}\n`);
    return true;
  } catch (err) {
    if (err && err.code === 'EPIPE') return false; // reader vanished mid-write
    throw err;
  } finally {
    try { fs.closeSync(fd); } catch (_e) { /* fd closed by the reader draining the FIFO */ }
  }
}

function _compactInflightFlag(root) {
  return path.join(root || process.cwd(), 'tmp', 'hme-cc-compact.inflight');
}

// Cross-slot, cross-process single-flight guard for the auto-compact path.
// Both proxy slots see the same over-window response stream and each over-window
function submitCcCompactOnce(root, { ttlMs = 300_000, now = Date.now() } = {}) {
  const flag = _compactInflightFlag(root);
  try {
    const st = fs.statSync(flag);
    if (now - st.mtimeMs < ttlMs) return { submitted: false, reason: 'inflight' };
  } catch (err) {
    if (err && err.code !== 'ENOENT') throw err; // ENOENT = no cycle in flight
  }
  const delivered = submitCcShortcut(root, 'cc');
  if (!delivered) return { submitted: false, reason: 'no_bridge' };
  try {
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.writeFileSync(flag, String(now));
  } catch (err) {
    // The token is already delivered; a missing flag only weakens the
    // single-flight guard for the next overflow. Surface it rather than hide it.
    throw err;
  }
  return { submitted: true, reason: 'submitted' };
}

// Clear the single-flight guard once a compact cycle has visibly succeeded
// (a non-over-window interactive response), so a later genuine overflow can
function clearCcCompactInflight(root) {
  try {
    fs.unlinkSync(_compactInflightFlag(root));
    return true;
  } catch (err) {
    if (err && err.code === 'ENOENT') return false; // already clear
    throw err;
  }
}

module.exports = { ccControlFifo, submitCcShortcut, submitCcCompactOnce, clearCcCompactInflight };
