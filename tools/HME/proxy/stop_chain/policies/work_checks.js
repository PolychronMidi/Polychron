'use strict';
/**
 * Pure-JS port of work_checks.sh — STOP_WORK / EXHAUST_CHECK gates plus
 * the AUTO-COMPLETENESS INJECT counter. Verdicts come from the verdicts
 * file; the enforcement reminder still goes to stderr; the inject counter
 * lives in tmp/hme-completeness-injected.json (50-entry cap, FIFO eviction).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('../../shared');

const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-stop-detector-verdicts.env');
const COMPL_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-completeness-injected.json');
const COMPL_MAX = 2;

const REASONS = {
  STOP_WORK_DISMISSIVE:
    'STOP-WORK ANTIPATTERN: You responded with dismissive text instead of doing work. Re-read the user prompt and the conversation. There is always pending work after a user message — find it and do it. If genuinely nothing remains, explain what was completed and why.',
  STOP_WORK_TEXT_ONLY:
    'STOP-WORK ANTIPATTERN: Your last turn was a short text-only response with no tool calls. If there is remaining work, continue it now. If you genuinely completed everything, provide a substantive summary of what was done.',
  EXHAUST:
    'EXHAUST PROTOCOL VIOLATION: Final text enumerated remaining items (TBD/noted/remaining tools) without fixing them. Every enumerated item must be fixed in the same turn. Resume and implement the highest-leverage items now.',
  COMPL_ROUND_1:
    "AUTO-COMPLETENESS INJECT (round 1/2): Before stopping, enumerate everything that might still be missing, unfinished, deferred, flagged, a possible gap, or worth doing relative to THIS TURN's work. Then do ALL of it — no deferrals, no flagging, no punts. If truly nothing remains, state 'Nothing missed' explicitly. This is the auto-injected version of the user's usual 'what's missing? do all' follow-up.",
  COMPL_ROUND_2:
    "AUTO-COMPLETENESS INJECT (round 2/2 — safety net): Last chance to catch unfinished or skipped work before the turn ends. If you claimed 'Nothing missed' in the last response, are you SURE nothing else is worth doing? Anything you'd normally flag as 'could be followed up' or 'worth investigating separately' — do it now. If confirmed nothing remains, say so plainly and the turn will end.",
};

const ENFORCEMENT_REMINDER =
  'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.';

const HOOK_INJECT_PREFIXES = [
  'Stop hook feedback:',
  'AUTO-COMPLETENESS INJECT',
  '🚨 LIFESAVER',
  'NEXUS —',
  '[[HME_AGENT_TASK',
  'PreToolUse:',
  'PostToolUse:',
];

function readVerdicts() {
  const out = { STOP_WORK: 'ok', EXHAUST_CHECK: 'ok' };
  if (!fs.existsSync(VERDICTS_FILE)) return out;
  let text = '';
  try { text = fs.readFileSync(VERDICTS_FILE, 'utf8'); }
  catch (_e) { return out; }
  for (const line of text.split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k in out) out[k] = v;
  }
  return out;
}

function lastRealUserPrompt(transcriptPath) {
  if (!transcriptPath) return { text: '', turnIndex: 0 };
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return { text: '', turnIndex: 0 }; }
  let last = '';
  let lastTurnIndex = 0;
  let turnIndex = 0;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'user') continue;
    const content = (entry.message && entry.message.content) || entry.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join(' ');
    }
    text = text.trim();
    if (!text) continue;
    if (HOOK_INJECT_PREFIXES.some((p) => text.startsWith(p))) continue;
    // Each user message is a distinct "turn" -- the COMPL counter dedups
    // per turnIndex so identical-text repeats (user retyping the same
    // frustrated message) each get their own fresh COMPL_MAX budget.
    // Without this, the counter saturated at 2 on the first occurrence
    // and every subsequent repeat silently skipped auto-completeness.
    turnIndex++;
    last = text;
    lastTurnIndex = turnIndex;
  }
  return { text: last, turnIndex: lastTurnIndex };
}

function loadComplStore() {
  try { return JSON.parse(fs.readFileSync(COMPL_FILE, 'utf8')); }
  catch (_e) { return {}; }
}

function saveComplStore(store) {
  // Cap at 50 entries — drop oldest by insertion order (object iteration order).
  const keys = Object.keys(store);
  if (keys.length > 50) {
    for (const k of keys.slice(0, keys.length - 50)) delete store[k];
  }
  try {
    fs.mkdirSync(path.dirname(COMPL_FILE), { recursive: true });
    const tmp = COMPL_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(store));
    fs.renameSync(tmp, COMPL_FILE);
  } catch (_e) { /* best-effort */ }
}

module.exports = {
  name: 'work_checks',
  async run(ctx) {
    // Default enforcement reminder always goes to stderr (informational; not
    // a deny — Claude Code surfaces stderr on Stop without blocking).
    process.stderr.write(ENFORCEMENT_REMINDER + '\n');

    const v = readVerdicts();
    if (v.STOP_WORK === 'DISMISSIVE')      return ctx.deny(REASONS.STOP_WORK_DISMISSIVE);
    if (v.STOP_WORK === 'TEXT_ONLY_SHORT') return ctx.deny(REASONS.STOP_WORK_TEXT_ONLY);
    if (v.EXHAUST_CHECK === 'exhaust_violation') return ctx.deny(REASONS.EXHAUST);

    // Auto-completeness inject — fires up to COMPL_MAX times per user-turn.
    // PRIOR FIX REMOVED: previously this skipped when any earlier policy
    // (PSYCHOPATHIC-STOP, etc.) already denied. That meant the user only
    // saw the EARLIEST deny, never auto-completeness. The user's repeated
    // screams about "auto-completeness still not firing" traced directly
    // here -- when PSYCHOPATHIC-STOP fired, auto-completeness silently
    // skipped. Auto-completeness now ALWAYS fires when conditions allow,
    // regardless of prior denies. The Stop chain runner emits the FIRST
    // deny as the block reason; if multiple policies deny, downstream
    // implementations need to either chain the messages or surface them
    // separately. For now: the first-deny-wins behavior in the runner
    // means auto-completeness's deny may be hidden if PSYCHOPATHIC-STOP
    // already won, but the COMPL counter advances correctly so round 2
    // fires on the next opportunity.

    const transcriptPath = ctx.payload && ctx.payload.transcript_path;
    if (!transcriptPath) return ctx.allow();
    const { text: lastUser, turnIndex } = lastRealUserPrompt(transcriptPath);
    if (!lastUser) return ctx.allow();

    // Dedup key includes turnIndex so identical-text repeats (user retyping
    // the same prompt verbatim while frustrated) each get their own budget.
    // Pre-fix: counter saturated at 2 on first occurrence -> every repeat
    // skipped auto-completeness silently. The user's "STILL NOT FIRING"
    // recurring scream traces directly to this bug.
    const turnKey = crypto.createHash('sha256')
      .update(`${turnIndex}|${lastUser}`)
      .digest('hex').slice(0, 16);
    const store = loadComplStore();
    const count = parseInt(store[turnKey], 10) || 0;
    if (count >= COMPL_MAX) return ctx.allow();

    const next = count + 1;
    store[turnKey] = next;
    saveComplStore(store);

    return ctx.deny(next === 1 ? REASONS.COMPL_ROUND_1 : REASONS.COMPL_ROUND_2);
  },
};
