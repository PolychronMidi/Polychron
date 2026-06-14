'use strict';

const crypto = require('crypto');

function _hash(value) {
  return 'sha256:' + crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function normalizeEntry(entry = {}) {
  return {
    source_files: Array.isArray(entry.source_files) ? entry.source_files.slice().sort() : [],
    symbols: Array.isArray(entry.symbols) ? entry.symbols.slice().sort() : [],
    tests: Array.isArray(entry.tests) ? entry.tests.slice().sort() : [],
    decision_date: entry.decision_date || '',
    supersession_condition: entry.supersession_condition || '',
    confidence: typeof entry.confidence === 'number' ? entry.confidence : 0,
    evidence_hash: entry.evidence_hash || '',
    source_checksums: entry.source_checksums || {},
    symbol_checksums: entry.symbol_checksums || {},
  };
}

function validateEntry(entry = {}) {
  const e = normalizeEntry(entry);
  const errors = [];
  if (!e.source_files.length) errors.push('missing source_files');
  if (!e.symbols.length) errors.push('missing symbols');
  if (!e.tests.length) errors.push('missing tests');
  if (typeof e.decision_date !== 'string' || Number.isNaN(Date.parse(e.decision_date))) errors.push('invalid decision_date');
  if (typeof e.supersession_condition !== 'string' || !e.supersession_condition.trim()) errors.push('missing supersession_condition');
  if (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1) errors.push('invalid confidence');
  if (typeof e.evidence_hash !== 'string' || !/^sha256:[a-fA-F0-9]{64}$/.test(e.evidence_hash)) errors.push('invalid evidence_hash');
  return { ok: errors.length === 0, errors, entry: e };
}

function checksumEntry(entry) {
  const e = normalizeEntry(entry);
  const src = {
    source_files: e.source_files,
    symbols: e.symbols,
    tests: e.tests,
    decision_date: e.decision_date,
    supersession_condition: e.supersession_condition,
    confidence: e.confidence,
    evidence_hash: e.evidence_hash,
    source_checksums: e.source_checksums,
    symbol_checksums: e.symbol_checksums,
  };
  return _hash(src);
}

function isPossiblyStale(entry, invalidators = []) {
  const files = new Set(entry.source_files || []);
  const symbols = new Set(entry.symbols || []);
  const sourceChecksums = entry.source_checksums || {};
  const symbolChecksums = entry.symbol_checksums || {};
  for (const inv of invalidators || []) {
    if (!inv || typeof inv !== 'object') continue;
    if (inv.path && files.has(inv.path)) {
      if (!inv.checksum || !sourceChecksums[inv.path] || inv.checksum !== sourceChecksums[inv.path]) {
        return { stale: true, reason: 'source_file_changed', invalidator: inv };
      }
    }
    if (inv.symbol && symbols.has(inv.symbol)) {
      if (!inv.checksum || !symbolChecksums[inv.symbol] || inv.checksum !== symbolChecksums[inv.symbol]) {
        return { stale: true, reason: 'symbol_changed', invalidator: inv };
      }
    }
    if ((entry.id && inv.supersedes === entry.id) || (entry.supersession_condition && inv.reason && String(inv.reason).includes(entry.supersession_condition))) {
      return { stale: true, reason: 'supersession_condition_met', invalidator: inv };
    }
  }
  return { stale: false, reason: 'fresh' };
}

module.exports = { normalizeEntry, validateEntry, checksumEntry, isPossiblyStale };
