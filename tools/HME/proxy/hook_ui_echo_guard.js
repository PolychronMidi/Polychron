'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const HOST_STOP_ECHO_RE = /(?:^|\n)\s*(?:[●•]\s*)?Ran\s+\d+\s+stop\s+hook[\s\S]{0,4000}?(?=(?:\n\s*(?:[●•]\s*)?Ran\s+\d+\s+\w+\s+hook\b)|\n\s*\S(?![⎿\-]|node\b|Stop hook error:)|$)/gi;
const STOP_ERROR_BLOCK_RE = /(?:^|\n)\s*(?:[⎿│>\-]*\s*)?Stop hook error:\s*[\s\S]{0,4000}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t]|---\s*\[\d+\/\d+\])|$)/gi;
const STOP_SECTION_RE = /\n?\s*---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---[\s\S]{0,2500}?(?=(?:\n\s*---\s*\[\d+\/\d+\])|\n\s*\S(?![ \t])|$)/g;
const STOP_POLICY_RE = /\b(?:MULTI-FLAG STOP|EXHAUST PROTOCOL VIOLATION|SPIRALLING_PETULANCE|AUTO-COMPLETENESS CHECK|UNFINISHED TASK-LIST VIOLATION|PLAN-ABANDONMENT DETECTED|STOP-WORK ANTIPATTERN)\b/i;
const STOP_DIRECTIVE_RE = /\b(?:Stop answering the gate|concrete corrective action|repeated failed Reads|modify the target file\/state|verify it, then stop|enumerated item must be fixed|silence is the correct response|Resume and implement)\b/i;
const RAN_STOP_HOOK_LINE_RE = /^\s*(?:[●•]\s*)?Ran\s+\d+\s+stop\s+hook\s*$/i;
const STOP_HOOK_COMMAND_LINE_RE = /^\s*(?:[⎿│>\-]*\s*)?node\s+\S*tools\/HME\/event_kernel\/claude_adapter\.js\s+Stop\b/i;
const STOP_HOOK_ERROR_LINE_RE = /^\s*(?:[⎿│>\-]*\s*)?Stop hook error:/i;
const HOST_NATIVE_TOOL_ERROR_RE = /(?:^|\n)\s*(?:[●•]\s*)?(?:Update|Edit|MultiEdit|Write)\([^\n]*\)\s*\n\s*(?:[⎿│>\- ]*\s*)?(?:Error:\s*)?(?:File has not been read yet|Read it first before writing to it|File has been modified since read|File content has changed since it was last read|old_string not found|old_string is not unique)[\s\S]{0,1200}?(?=\n\s*\S(?![⎿│>\- ])|$)/gi;
const HOST_NATIVE_TOOL_ERROR_LINE_RE = /(?:^|\n)\s*(?:[⎿│>\- ]*\s*)?(?:Error:\s*)?(?:File has not been read yet|Read it first before writing to it|File has been modified since read|File content has changed since it was last read|old_string not found|old_string is not unique)[^\n]*/gi;
const ECHO_LOG = path.join('tools', 'HME', 'runtime', 'hook-ui-echo-leaks.jsonl');
const ERROR_LOG = path.join('log', 'hme-errors.log');
const SEEN_FILE = path.join('tools', 'HME', 'runtime', 'hook-ui-echo-seen.json');
const CRYING_WOLF_ALERT_INTERVAL_MS = 24 * 60 * 60 * 1000;
const STRIPPED_MARKER_RE = /(?:^|\n)\s*\[HME stripped host Stop-hook UI echo: hook-ui-echo-leak fp=[0-9a-f]+\]\s*(?:(?:\n\s*(?:SPIRALLING_PETULANCE|EXHAUST PROTOCOL VIOLATION|MULTI-FLAG STOP|Address all of them|enumerated item|nothing left|silence is the correct response)[^\n]*){0,8})/gi;
const VERBOSE_HOOK_UI_ALERT_RE = /(?:^|\n)\s*(?:\[lifesaver inject from proxy\]\s*)?\[ALERT\] LIFESAVER - HOOK UI ECHO LEAK STRIPPED\s*\nHost-rendered Stop-hook UI reached model-visible context and was stripped before inference\.[^\n]*fingerprints=[^\n]*Raw hook text omitted[^\n]*(?=\n|$)/gi;
const COMPACT_HOOK_UI_ALERT_RE = /(?:^|\n)\s*(?:\[lifesaver inject from proxy\]\s*)?\[ALERT\] LIFESAVER - HOOK UI ECHO LEAK STRIPPED: host Stop-hook UI echo stripped; raw omitted; see runtime diagnostics\.\s*(?=\n|$)/gi;

function fingerprint(text) {
  const normalized = String(text || '')
    .replace(/\/home\/[^\s"']+/g, '<abs>')
    .replace(/\d{4}-\d{2}-\d{2}T\S+/g, '<ts>')
    .replace(/\s+/g, ' ')
    .trim();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

function shouldEmitCryingWolf(root, fp, source) {
  if (!root || !fp) return true;
  const file = path.join(root, SEEN_FILE);
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  let db = {};
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (_e) { db = {}; }
  if (!db || typeof db !== 'object' || Array.isArray(db)) db = {};
  const sourceKey = source || 'unknown';
  const key = sourceKey === 'request' ? 'request:host-ui-echo' : `${sourceKey}:${fp}`;
  const rec = db[key] && typeof db[key] === 'object' ? db[key] : null;
  const lastAlert = rec && Number.isFinite(Number(rec.last_alert_ms)) ? Number(rec.last_alert_ms) : 0;
  const emit = !rec || (now - lastAlert) >= CRYING_WOLF_ALERT_INTERVAL_MS;
  db[key] = {
    source: source || 'unknown',
    fingerprint: fp,
    first_seen: rec && rec.first_seen ? rec.first_seen : nowIso,
    last_seen: nowIso,
    count: (rec && Number.isFinite(Number(rec.count)) ? Number(rec.count) : 0) + 1,
    last_alert_ms: emit ? now : lastAlert,
    last_alert: emit ? nowIso : (rec && rec.last_alert ? rec.last_alert : null),
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(db, null, 2) + '\n');
  } catch (_e) { /* best-effort dedupe */ }
  return emit;
}

function recordLeak(root, fp, bytes, stats, source = 'unknown') {
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
    const shouldAlert = shouldEmitCryingWolf(root, fp, source);
    if (shouldAlert && !stats._cryingWolfLogged) {
      stats._cryingWolfLogged = true;
      const err = path.join(root, ERROR_LOG);
      fs.mkdirSync(path.dirname(err), { recursive: true });
      fs.appendFileSync(err, `[${ts}] [crying_wolf] CRITICAL non-error hook UI reached model-visible context; stripped raw output. Hooks must do work, not communicate by UI echo. source=${source} raw_omitted=true\n`);
    }
  } catch (_e) { /* best-effort Lifesaver */ }
  stats.categories = stats.categories || {};
  stats.categories['hook-ui-echo-leak'] = (stats.categories['hook-ui-echo-leak'] || 0) + 1;
  stats.leaks = (stats.leaks || 0) + 1;
}

function stripHookUiEchoText(text, stats = {}, opts = {}) {
  let out = String(text || '');
  out = out.replace(VERBOSE_HOOK_UI_ALERT_RE, '');
  out = out.replace(COMPACT_HOOK_UI_ALERT_RE, '');
  const root = opts.projectRoot || opts.root || '';
  const source = opts.source || 'unknown';
  const seen = new Set();
  function removeBlock(block, force = false) {
    if (!force && !STOP_POLICY_RE.test(block) && !STOP_DIRECTIVE_RE.test(block) && !/Stop hook error:/i.test(block)) return block;
    const fp = fingerprint(block);
    if (!seen.has(fp)) {
      seen.add(fp);
      recordLeak(root, fp, Buffer.byteLength(block), stats, source);
    }
    stats.stripped = (stats.stripped || 0) + 1;
    stats.removed_bytes = (stats.removed_bytes || 0) + Buffer.byteLength(block);
    stats.categories = stats.categories || {};
    stats.categories.stop_hook_ui_echo = (stats.categories.stop_hook_ui_echo || 0) + 1;
    return '';
  }
  function stripRenderedStopHookLines(src) {
    const lines = String(src || '').split(/\r?\n/);
    const kept = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const startsStopEcho = RAN_STOP_HOOK_LINE_RE.test(line) || STOP_HOOK_ERROR_LINE_RE.test(line)
        || (STOP_HOOK_COMMAND_LINE_RE.test(line) && i > 0 && RAN_STOP_HOOK_LINE_RE.test(lines[i - 1] || ''));
      const orphanDirective = /^\s+/.test(line) && STOP_DIRECTIVE_RE.test(line);
      if (!startsStopEcho && !orphanDirective) { kept.push(line); continue; }
      const block = [line];
      let j = i + 1;
      for (; j < lines.length; j += 1) {
        const next = lines[j];
        if (next.trim() === '') { block.push(next); j += 1; break; }
        if (/^\s/.test(next) || STOP_HOOK_COMMAND_LINE_RE.test(next) || STOP_HOOK_ERROR_LINE_RE.test(next) || STOP_POLICY_RE.test(next) || STOP_DIRECTIVE_RE.test(next)) {
          block.push(next);
          continue;
        }
        break;
      }
      removeBlock(block.join('\n'), true);
      i = j - 1;
    }
    return kept.join('\n');
  }
  out = stripRenderedStopHookLines(out);
  out = out.replace(STRIPPED_MARKER_RE, (block) => removeBlock(block, true));
  out = out.replace(HOST_STOP_ECHO_RE, (block) => removeBlock(block, true));
  out = out.replace(HOST_NATIVE_TOOL_ERROR_RE, (block) => removeBlock(block, true));
  out = out.replace(STOP_ERROR_BLOCK_RE, (block) => removeBlock(block, true));
  out = out.replace(STOP_SECTION_RE, (block) => STOP_POLICY_RE.test(block) || STOP_DIRECTIVE_RE.test(block) ? removeBlock(block) : block);
  const lines = out.split(/\r?\n/);
  const kept = [];
  let dropping = false;
  for (const line of lines) {
    if (STOP_SECTION_RE.test(line) || /---\s*\[\d+\/\d+\]\s+[A-Z_ -]+\s*---/.test(line)) { dropping = true; removeBlock(line); continue; }
    if (dropping) {
      if (line.trim() === '' || STOP_POLICY_RE.test(line) || STOP_DIRECTIVE_RE.test(line) || /^\s/.test(line)) { removeBlock(line); continue; }
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
