'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function maxBytes(value = process.env.HME_RUNTIME_LOG_MAX_BYTES) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function rotateIfNeeded(file, limit = maxBytes()) {
  try {
    const stat = fs.statSync(file);
    if (stat.size <= limit) return;
    try { fs.rmSync(`${file}.1`, { force: true }); } catch (_err) { /* best-effort */ }
    fs.renameSync(file, `${file}.1`);
    // silent-ok: rotation is observability-only; append still writes current log.
  } catch (_err) {
    // Missing/unreadable logs are best-effort observability only.
  }
}

function appendLine(file, line, options = {}) {
  const limit = maxBytes(options.maxBytes);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  rotateIfNeeded(file, limit);
  fs.appendFileSync(file, line.endsWith('\n') ? line : `${line}\n`);
}

function appendJsonl(file, row, options = {}) {
  appendLine(file, JSON.stringify(row), options);
}

module.exports = { appendLine, appendJsonl, rotateIfNeeded, maxBytes, DEFAULT_MAX_BYTES };
