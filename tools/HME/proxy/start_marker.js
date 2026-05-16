'use strict';

function emitStartMarker(name, details = {}) {
  const fields = Object.entries({ pid: process.pid, ...details })
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, '_')}`)
    .join(' ');
  process.stderr.write(`=== ${name} start ${new Date().toISOString()} ${fields} ===\n`);
}

module.exports = { emitStartMarker };
