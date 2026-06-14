'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const DEFAULT_LEDGER = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'tool-response-quality.jsonl');
const DEFAULT_WAIVER_LEDGER = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'tool-response-waivers.jsonl');
const CONTRACT_RATING = 10;
const DEFECT_CLASSES = Object.freeze([
  'low_rating',
  'false_success',
  'false_failure',
  'false_no_output',
  'output_bloat',
  'stale_state',
  'policy_bypass',
  'schema_violation',
  'timeout',
  'unknown',
]);
const REPAIR_STATUSES = Object.freeze(['open', 'investigating', 'repairing', 'fixed', 'waived']);
const DEFECT_SET = new Set(DEFECT_CLASSES);
const REPAIR_SET = new Set(REPAIR_STATUSES);

function _nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function _toIso(value, fallback = null) {
  if (!value) return fallback;
  const t = Date.parse(value);
  return Number.isNaN(t) ? fallback : new Date(t).toISOString();
}

function shouldLog(entry, threshold = 7) {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.contract_violation === true) return true;
  if (typeof entry.rating === 'number' && entry.rating < threshold) return true;
  return false;
}

function classify(entry, threshold = 7) {
  if (entry && entry.contract_violation === true) return entry.defect_class || 'schema_violation';
  if (entry && typeof entry.rating === 'number' && entry.rating < threshold) return entry.defect_class || 'low_rating';
  return entry && entry.defect_class ? entry.defect_class : 'unknown';
}

function normalize(entry, opts = {}) {
  if (!entry || typeof entry !== 'object') throw new Error('tool-response-quality: entry object required');
  const now = new Date().toISOString();
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 7;
  const defect_class = String(entry.defect_class || classify(entry, threshold));
  const row = {
    ts: _toIso(entry.ts, now),
    tool: String(entry.tool || 'unknown'),
    rating: typeof entry.rating === 'number' ? entry.rating : CONTRACT_RATING,
    defect_class,
    defect: String(entry.defect || ''),
    owner: String(entry.owner || ''),
    reproduction: String(entry.reproduction || ''),
    repair_status: String(entry.repair_status || 'open'),
    waiver_expires_at: _toIso(entry.waiver_expires_at, null),
    waiver_reason: entry.waiver_reason ? String(entry.waiver_reason) : '',
    evidence: entry.evidence || null,
    regression: entry.regression || null,
    contract_violation: entry.contract_violation === true,
  };
  row.validation_errors = validationErrors(row, { requireActionable: shouldLog(row, threshold) });
  return row;
}

function validationErrors(row, opts = {}) {
  const errors = [];
  const requireActionable = opts.requireActionable !== false;
  if (!row || typeof row !== 'object') return ['entry must be object'];
  if (!DEFECT_SET.has(row.defect_class)) errors.push(`invalid defect_class ${row.defect_class || ''}`);
  if (!REPAIR_SET.has(row.repair_status)) errors.push(`invalid repair_status ${row.repair_status || ''}`);
  if (requireActionable) {
    if (!_nonEmptyString(row.owner)) errors.push('missing owner');
    if (!_nonEmptyString(row.reproduction)) errors.push('missing reproduction');
    if (!row.regression) errors.push('missing regression link');
  }
  if (row.repair_status === 'waived') {
    if (!_nonEmptyString(row.waiver_reason)) errors.push('missing waiver_reason');
    if (!row.waiver_expires_at) errors.push('missing waiver_expires_at');
    if (row.waiver_expires_at && Date.parse(row.waiver_expires_at) <= Date.now()) errors.push('expired waiver');
    if (!row.evidence) errors.push('missing waiver evidence');
  }
  return errors;
}

function readLedger(file = DEFAULT_LEDGER) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_e) { return null; }
  }).filter(Boolean);
}

function appendRow(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(row) + '\n');
}

function record(entry, opts = {}) {
  const row = normalize(entry, opts);
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 7;
  if (!shouldLog(row, threshold)) return { logged: false, entry: row };
  if (opts.strict && row.validation_errors.length) {
    throw new Error(`tool-response-quality invalid row: ${row.validation_errors.join('; ')}`);
  }
  const file = opts.file || DEFAULT_LEDGER;
  appendRow(file, row);
  return { logged: true, entry: row, file };
}

function isWaiverActive(entry, now = Date.now()) {
  if (!entry || entry.repair_status !== 'waived' || !entry.waiver_expires_at) return false;
  return Date.parse(entry.waiver_expires_at) > now && validationErrors(entry, { requireActionable: true }).length === 0;
}

function recordWaiver(entry, opts = {}) {
  const row = normalize({ ...entry, repair_status: 'waived' }, opts);
  const errors = validationErrors(row, { requireActionable: true });
  if (errors.length) throw new Error(`tool-response-quality invalid waiver: ${errors.join('; ')}`);
  const file = opts.file || DEFAULT_WAIVER_LEDGER;
  appendRow(file, row);
  return { logged: true, entry: row, file };
}

function aggregateTooling(rowsOrFile = DEFAULT_LEDGER, opts = {}) {
  const rows = Array.isArray(rowsOrFile) ? rowsOrFile : readLedger(rowsOrFile);
  const threshold = Number.isFinite(opts.threshold) ? opts.threshold : 7;
  const open = rows.filter((r) => shouldLog(r, threshold) && !isWaiverActive(r));
  const by_class = {};
  const by_tool = {};
  for (const row of open) {
    const klass = row.defect_class || classify(row, threshold);
    by_class[klass] = (by_class[klass] || 0) + 1;
    by_tool[row.tool || 'unknown'] = (by_tool[row.tool || 'unknown'] || 0) + 1;
  }
  return {
    total_defects: open.length,
    contract_violations: open.filter((r) => r.contract_violation === true).length,
    low_ratings: open.filter((r) => typeof r.rating === 'number' && r.rating < threshold).length,
    invalid_rows: rows.filter((r) => Array.isArray(r.validation_errors) && r.validation_errors.length > 0).length,
    by_class,
    by_tool,
  };
}

module.exports = {
  DEFAULT_LEDGER,
  DEFAULT_WAIVER_LEDGER,
  CONTRACT_RATING,
  DEFECT_CLASSES,
  REPAIR_STATUSES,
  normalize,
  validationErrors,
  shouldLog,
  classify,
  record,
  readLedger,
  recordWaiver,
  isWaiverActive,
  aggregateTooling,
};
