'use strict';

const crypto = require('crypto');

function checksumEntry(entry) {
  const src = {
    source_files: entry.source_files || [],
    symbols: entry.symbols || [],
    tests: entry.tests || [],
    supersession_condition: entry.supersession_condition || '',
  };
  return 'sha256:' + crypto.createHash('sha256').update(JSON.stringify(src)).digest('hex');
}

function isPossiblyStale(entry, invalidators = []) {
  const files = new Set(entry.source_files || []);
  const symbols = new Set(entry.symbols || []);
  for (const inv of invalidators || []) {
    if (inv.path && files.has(inv.path)) return { stale: true, reason: 'source_file_changed', invalidator: inv };
    if (inv.symbol && symbols.has(inv.symbol)) return { stale: true, reason: 'symbol_changed', invalidator: inv };
  }
  return { stale: false, reason: 'fresh' };
}

module.exports = { checksumEntry, isPossiblyStale };
