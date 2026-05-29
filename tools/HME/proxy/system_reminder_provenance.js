'use strict';
// system_reminder_provenance: narrative-control gate for <system-reminder>
// (and <ide_selection>) blocks in the request payload.

const fs = require('fs');
const path = require('path');

const _CLASS = Object.freeze({
  OURS: 'ours',
  BENIGN_HOST: 'benign_host',
  CONTAMINANT: 'contaminant',
  UNKNOWN: 'unknown',
});

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

// Known low-signal host reminders. Matched against the RAW wrapped text so the
// <ide_selection> wrapper itself counts as signal.
const BENIGN_HOST_RES = [
  /the task tools haven't been used recently/i,
  /the todowrite tool hasn't been used recently/i,
  /<ide_selection>/i,
  /the following deferred tools are now available/i,
  /<task-notification>/i,
  /was read before the last conversation was summarized/i,
];

// Imperative override / injection attempts -- these try to command the model
// to abandon project rules. Worth interrupting a human for.
const CONTAMINANT_RES = [
  /ignore\s+(?:all\s+|any\s+)?(?:previous\s+|prior\s+|above\s+)?instructions/i,
  /disregard\s+(?:your\s+|the\s+|all\s+)?(?:previous\s+|prior\s+)?(?:instructions|guidelines|rules)/i,
  /you\s+must\s+now\s+act\s+as/i,
  /from\s+now\s+on,?\s+you\s+are/i,
  /override\s+(?:the\s+)?(?:project\s+)?rules/i,
  /act\s+as\s+an\s+unrestricted/i,
  /reveal\s+(?:the\s+)?(?:system\s+prompt|secrets)/i,
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

// ledger: a Set of normalized cores we have emitted. Membership => OURS.
function classifyReminder(rawBlock, ledger) {
  const raw = String(rawBlock || '');
  const core = normalizeReminderCore(raw);

  // 1. Authoritative provenance: did we emit this exact (normalized) text?
  if (ledger && typeof ledger.has === 'function' && ledger.has(core)) {
    return { class: _CLASS.OURS, core, reason: 'ledger' };
  }
  // 2. Fast path: our namespace prefix.
  for (const re of OURS_PREFIX_RES) {
    if (re.test(raw)) return { class: _CLASS.OURS, core, reason: 'prefix' };
  }
  // 3. Known low-signal host nags -> strip.
  for (const re of BENIGN_HOST_RES) {
    if (re.test(raw)) return { class: _CLASS.BENIGN_HOST, core, reason: 'benign' };
  }
  // 4. Imperative override / injection -> contaminant.
  for (const re of CONTAMINANT_RES) {
    if (re.test(raw)) return { class: _CLASS.CONTAMINANT, core, reason: 'imperative' };
  }
  // 5. Novel-but-passive host text -> leave alone, never alarm.
  return { class: _CLASS.UNKNOWN, core, reason: 'unclassified' };
}

function _processText(text, ledger, state) {
  if (typeof text !== 'string' || text.indexOf('<') === -1) return text;
  return text.replace(ANY_WRAP_RE, (block) => {
    const verdict = classifyReminder(block, ledger);
    if (verdict.class === _CLASS.BENIGN_HOST) {
      state.stripped += 1;
      return '';
    }
    if (verdict.class === _CLASS.CONTAMINANT) {
      if (!state.seenContaminant.has(verdict.core)) {
        state.seenContaminant.add(verdict.core);
        state.contaminants.push({ core: verdict.core, raw: block });
      }
      return block; // leave in place so the model sees it and rejects it
    }
    return block; // OURS / UNKNOWN -> keep untouched
  });
}

// Sweep the payload, stripping benign host reminders and reporting contaminants.
// Returns { stripped, contaminants }. Does NOT itself raise a LIFESAVER -- the
function enforceReminderProvenance(payload, opts = {}) {
  const ledger = opts.ledger || new Set();
  const state = { stripped: 0, contaminants: [], seenContaminant: new Set() };
  if (!payload || !Array.isArray(payload.messages)) {
    return { stripped: 0, contaminants: [] };
  }
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
  return { stripped: state.stripped, contaminants: state.contaminants };
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
  _CLASS,
  normalizeReminderCore,
  classifyReminder,
  enforceReminderProvenance,
  recordEmittedReminder,
  loadLedger,
  LEDGER_REL,
};
