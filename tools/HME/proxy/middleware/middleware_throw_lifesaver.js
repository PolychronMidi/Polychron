'use strict';
// Bridge: route any middleware throw to the LIFESAVER channel.
//

const fs = require('fs');
const path = require('path');

const ERROR_LOG_REL = path.join('log', 'hme-errors.log');

// Round-trip detector for our own emitted line.
const _MIDDLEWARE_THROW_RE = /\[middleware-throw\] LIFESAVER -- /;

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function _errText(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

// Build the single log line (no trailing newline). Collapse whitespace so a
// multi-line error message can't smuggle in a blank line the scanner drops.
function formatMiddlewareThrowLine(modName, err) {
  const name = String(modName || 'unknown');
  const msg = _errText(err).replace(/\s+/g, ' ').slice(0, 600);
  return `[${_ts()}] [middleware-throw] LIFESAVER -- middleware ${name}.onRequest threw and was swallowed: ${msg}`;
}

function recordMiddlewareThrow(root, modName, err) {
  try {
    const logPath = path.join(root, ERROR_LOG_REL);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, formatMiddlewareThrowLine(modName, err) + '\n');
    return true;
  } catch (_e) {
    return false;
  }
}

module.exports = {
  formatMiddlewareThrowLine,
  recordMiddlewareThrow,
  _MIDDLEWARE_THROW_RE,
  ERROR_LOG_REL,
};
