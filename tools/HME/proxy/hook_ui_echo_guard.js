'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST_STOP_ECHO_RE = /(?:^|\n)\s*(?:[●•]\s*)?Ran\s+\d+\s+stop\s+hook[\s\S]{0,4000}?(?=(?:\n\s*(?:[●•]\s*)?Ran\s+\d+\s+\w+\s+hook\b)|\n\s*\S(?![⎿\-]|node\b|Stop hook error:)|$)/gi;
const STOP_ERROR_BLOCK_RE = /(?:^|\n)\s*(?:[⎿│>\-]*\s*)?Stop hook error:\s*[\s\S]{0,4000}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t]|---\s*\[\d+\/\d+\])|$)/gi;
const STOP_SECTION_RE = /\n?\s*---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---[\s\S]{0,2500}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t])|$)/g;
const STOP_POLICY_RE = /\b(?:MULTI-FLAG STOP|EXHAUST PROTOCOL VIOLATION|SPIRALLING_PETULANCE|AUTO-COMPLETENESS CHECK|UNFINISHED TASK-LIST VIOLATION|PLAN-ABANDONMENT DETECTED|STOP-WORK ANTIPATTERN)\b/i;
const ECHO_LOG = path.join('tools', 'HME', 'runtime', 'hook-ui-echo-leaks.jsonl');
const LEAK_FLAG = path.join('tmp', 'hme-hook-ui-echo-leak.flag');
const STRIPPED_MARKER_RE = /(?:^|\n)\s*\[HME stripped host Stop-hook UI echo: hook-ui-echo-leak fp=[0-9a-f]+\]\s*(?:(?:\n\s*(?:SPIRALLING_PETULANCE|EXHAUST PROTOCOL VIOLATION|MULTI-FLAG STOP|Address all of them|enumerated item|nothing left|silence is the correct response)[^\n]*){0,8})/gi;
const VERBOSE_HOOK_UI_ALERT_RE = /(?:^|\n)\s*(?:\[lifesaver inject from proxy\]\s*)?\[ALERT\] LIFESAVER - HOOK UI ECHO LEAK STRIPPED\s*\nHost-rendered Stop-hook UI reached model-visible context and was stripped before inference\.[^\n]*fingerprints=[^\n]*Raw hook text omitted[^\n]*(?=\n|$)/gi;
const COMPACT_HOOK_UI_ALERT = '[ALERT] LIFESAVER - HOOK UI ECHO LEAK STRIPPED: host Stop-hook UI echo stripped; raw omitted; see runtime diagnostics.';

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
  stats._hookUiEchoSeen = stats._hookUiEchoSeen || new Set();
  if (stats._hookUiEchoSeen.has(fp)) return;
  stats._hookUiEchoSeen.add(fp);
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
    const flag = path.join(root, LEAK_FLAG);
    fs.mkdirSync(path.dirname(flag), { recursive: true });
    fs.appendFileSync(flag, JSON.stringify(row) + '\n');
  } catch (_e) { /* best-effort same-turn alert */ }
  stats.categories = stats.categories || {};
  stats.categories['hook-ui-echo-leak'] = (stats.categories['hook-ui-echo-leak'] || 0) + 1;
  stats.leaks = (stats.leaks || 0) + 1;
}

function stripHookUiEchoText(text, stats = {}, opts = {}) {
  let out = String(text || '');
  let sawVerboseAlert = false;
  out = out.replace(VERBOSE_HOOK_UI_ALERT_RE, () => { sawVerboseAlert = true; return ''; });
  if (sawVerboseAlert) out = `${COMPACT_HOOK_UI_ALERT}\n${out.replace(/^\s+/, '')}`;
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
    return '';
  }
  out = out.replace(STRIPPED_MARKER_RE, removeBlock);
  out = out.replace(HOST_STOP_ECHO_RE, removeBlock);
  out = out.replace(STOP_ERROR_BLOCK_RE, removeBlock);
  out = out.replace(STOP_SECTION_RE, (block) => STOP_POLICY_RE.test(block) ? removeBlock(block) : block);
  const lines = out.split(/\r?\n/);
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    if (STOP_SECTION_RE.test(line) || /---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---/.test(line)) { dropping = true; removeBlock(line); continue; }
    if (dropping) {
      if (line.trim() === '' || STOP_POLICY_RE.test(line) || /^\s/.test(line)) { removeBlock(line); continue; }
      dropping = false;
    }
    kept.push(line);
  }
  return kept.join('\n');
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
