'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const DEFAULT_LEDGER = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'tool-response-quality.jsonl');
const CONTRACT_RATING = 10;

function shouldLog(entry, threshold = 7) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.contract_violation === true) return true;
  if (typeof entry.rating === 'number' && entry.rating < threshold) return true;
  return false;
}

function normalize(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('tool-response-quality: entry object required');
  const now = new Date().toISOString();
  return {
    ts: entry.ts || now,
    tool: String(entry.tool || 'unknown'),
    rating: typeof entry.rating === 'number' ? entry.rating : CONTRACT_RATING,
    defect_class: String(entry.defect_class || ''),
    defect: String(entry.defect || ''),
    owner: String(entry.owner || ''),
    reproduction: String(entry.reproduction || ''),
    repair_status: String(entry.repair_status || 'open'),
    waiver_expires_at: entry.waiver_expires_at || null,
    regression: entry.regression || null,
    contract_violation: entry.contract_violation === true,
  };
}

function record(entry, opts = {}) {
  const row = normalize(entry);
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 7;
  if (!shouldLog(row, threshold)) return { logged: false, entry: row };
  const file = opts.file || DEFAULT_LEDGER;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
  return { logged: true, entry: row, file };
}

module.exports = { DEFAULT_LEDGER, normalize, shouldLog, record };
