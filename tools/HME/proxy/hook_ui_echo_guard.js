'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST_STOP_ECHO_RE = /(?:^|\n)\s*(?:[●•]\s*)?Ran\s+\d+\s+stop\s+hook[\s\S]{0,4000}?(?=(?:\n\s*(?:[●•]\s*)?Ran\s+\d+\s+\w+\s+hook\b)|\n\s*\S(?![⎿\-]|node\b|Stop hook error:)|$)/gi;
const STOP_ERROR_BLOCK_RE = /(?:^|\n)\s*(?:[⎿│>\-]*\s*)?Stop hook error:\s*[\s\S]{0,4000}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t]|---\s*\[\d+\/\d+\])|$)/gi;
const STOP_SECTION_RE = /\n?\s*---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---[\s\S]{0,2500}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t])|$)/g;
const STOP_POLICY_RE = /\b(?:MULTI-FLAG STOP|EXHAUST PROTOCOL VIOLATION|SPIRALLING_PETULANCE|AUTO-COMPLETENESS CHECK|UNFINISHED TASK-LIST VIOLATION|PLAN-ABANDONMENT DETECTED|STOP-WORK ANTIPATTERN)\b/i;
const ECHO_LOG = path.join('tools', 'HME', 'runtime', 'hook-ui-echo-leaks.jsonl');
const ERROR_LOG = path.join('log', 'hme-errors.log');

function fingerprint(text) {
  const normalized = String(text || '')
    .replace(/\/home\/[^\s"']+/g, '<abs>')
    .replace(/\d{4}-\d{2}-\d{2}T\S+/g, '<ts>')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function recordLeak(root, fp, bytes, stats) {
  if (!root || !fp) return;
  const ts = new Date().toISOString();
  const row = {
    ts,
    event: 'hook-ui-echo-leak',
    severity: 'CRITICAL',
    fingerprint: fp,
    stripped_bytes: bytes,
  };
  try {
    const file = path.join(root, ECHO_LOG);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
  } catch (_e) { /* best-effort telemetry */ }
  try {
    const err = path.join(root, ERROR_LOG);
    fs.mkdirSync(path.dirname(err), { recursive: true });
    fs.appendFileSync(err, `[${ts}] [hook-ui-echo-leak] CRITICAL host-rendered Stop hook UI reached model-visible context; stripped. fingerprint=${fp} bytes=${bytes}  ${JSON.stringify(row)}\n`);
  } catch (_e) { /* best-effort lifesaver */ }
  stats.categories = stats.categories || {};
  stats.categories['hook-ui-echo-leak'] = (stats.categories['hook-ui-echo-leak'] || 0) + 1;
  stats.leaks = (stats.leaks || 0) + 1;
}

function stripHookUiEchoText(text, stats = {}, opts = {}) {
  let out = String(text || '');
  const root = opts.projectRoot || opts.root || '';
  const seen = new Set();
  function removeBlock(block) {
    if (!STOP_POLICY_RE.test(block) && !/Stop hook error:/i.test(block)) return block;
    const fp = fingerprint(block);
    if (!seen.has(fp)) {
      seen.add(fp);
      recordLeak(root, fp, Buffer.byteLength(block), stats);
    }
    stats.stripped = (stats.stripped || 0) + 1;
    stats.removed_bytes = (stats.removed_bytes || 0) + Buffer.byteLength(block);
    stats.categories = stats.categories || {};
    stats.categories.stop_hook_ui_echo = (stats.categories.stop_hook_ui_echo || 0) + 1;
    return '\n[HME stripped host Stop-hook UI echo: hook-ui-echo-leak fp=' + fp + ']';
  }
  out = out.replace(HOST_STOP_ECHO_RE, removeBlock);
  out = out.replace(STOP_ERROR_BLOCK_RE, removeBlock);
  out = out.replace(STOP_SECTION_RE, (block) => STOP_POLICY_RE.test(block) ? removeBlock(block) : block);
  return out;
}

function stripHookUiEchoInValue(value, stats = {}, opts = {}) {
  if (typeof value === 'string') return stripHookUiEchoText(value, stats, opts);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => stripHookUiEchoInValue(item, stats, opts));
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = stripHookUiEchoInValue(child, stats, opts);
  return out;
}

module.exports = { stripHookUiEchoText, stripHookUiEchoInValue, fingerprint };
