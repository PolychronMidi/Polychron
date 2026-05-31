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

module.exports = { ccControlFifo, submitCcShortcut };
