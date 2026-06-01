'use strict';
// system_reminder_provenance: narrative-control gate for <system-reminder>
// and <ide_selection> blocks in the request payload.

const fs = require('fs');
const path = require('path');

const REMINDER_WRAP_RE = /<system-reminder>([\s\S]*?)<\/system-reminder>/i;
const IDE_SEL_WRAP_RE = /<ide_selection>([\s\S]*?)<\/ide_selection>/i;
// Matches a whole wrapped block (either flavor) -- used for in-payload sweeps.
const ANY_WRAP_RE = /<system-reminder>[\s\S]*?<\/system-reminder>|<ide_selection>[\s\S]*?<\/ide_selection>/gi;

// ISO-8601-ish timestamps -> placeholder, so the same banner re-emitted at a
// different time hashes identically.
const TS_RE = /\[?\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]?/g;

// Namespace prefixes that only our own injections ever carry.
const OURS_PREFIX_RES = [
  /\bLIFESAVER\b/,
  /\bEVOLUTION CONTEXT\b/,
  /\[HME\b/,
  /\bHME learn\(\)/,
];

function _unwrap(text) {
  const s = String(text || '');
  const m = s.match(REMINDER_WRAP_RE) || s.match(IDE_SEL_WRAP_RE);
  return m ? m[1] : s;
}

function normalizeReminderCore(text) {
  let s = _unwrap(text);
  s = s.replace(TS_RE, '[<ts>]');
  s = s.replace(/\s+/g, ' ').trim().toLowerCase();
  return s;
}

// True iff the reminder block is ours: namespace prefix OR emitted-ledger hash.
function isOurs(rawBlock, ledger) {
  const raw = String(rawBlock || '');
  if (ledger && typeof ledger.has === 'function' && ledger.has(normalizeReminderCore(raw))) return true;
  for (const re of OURS_PREFIX_RES) {
    if (re.test(raw)) return true;
  }
  return false;
}

function _processText(text, ledger, state) {
  if (typeof text !== 'string' || text.indexOf('<') === -1) return text;
  return text.replace(ANY_WRAP_RE, (block) => {
    if (isOurs(block, ledger)) return block; // keep
    state.stripped += 1;
    return ''; // not ours -> strip
  });
}

// Sweep the payload, stripping every reminder/ide_selection block that is not
// of HME origin. Returns { stripped }.
function enforceReminderProvenance(payload, opts = {}) {
  const ledger = opts.ledger || new Set();
  const state = { stripped: 0 };
  if (!payload || !Array.isArray(payload.messages)) return { stripped: 0 };
  for (const msg of payload.messages) {
    if (!msg) continue;
    if (typeof msg.content === 'string') {
      msg.content = _processText(msg.content, ledger, state);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && block.type === 'text' && typeof block.text === 'string') {
          block.text = _processText(block.text, ledger, state);
        }
      }
    }
  }
  return { stripped: state.stripped };
}

//  emitted-reminder ledger 
// We record the normalized core of every reminder WE inject so the inspector

const LEDGER_REL = path.join('tools', 'HME', 'runtime', 'emitted-reminders.jsonl');
const LEDGER_CAP = 500; // rolling; older entries fall out of the in-memory set

function recordEmittedReminder(root, text, source) {
  try {
    const core = normalizeReminderCore(text);
    if (!core) return false;
    const logPath = path.join(root, LEDGER_REL);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify({ core, source: source || 'proxy' }) + '\n');
    return true;
    // silent-ok: provenance ledger is dedupe telemetry; reminder emission already occurred.
  } catch (_e) {
    return false;
  }
}

function loadLedger(root) {
  const set = new Set();
  try {
    const logPath = path.join(root, LEDGER_REL);
    const lines = fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines.slice(-LEDGER_CAP)) {
      try {
        const obj = JSON.parse(line);
        if (obj && obj.core) set.add(obj.core);
      } catch (_e) { /* skip malformed line */ }
    }
  } catch (_e) { /* no ledger yet */ }
  return set;
}

module.exports = {
  normalizeReminderCore,
  isOurs,
  enforceReminderProvenance,
  recordEmittedReminder,
  loadLedger,
  LEDGER_REL,
};
