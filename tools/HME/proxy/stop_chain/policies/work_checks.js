/**
 * STOP_WORK / EXHAUST_CHECK gates plus AUTO-COMPLETENESS.
 * Ordered strategies preserve first-deny-wins semantics.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT, RUNTIME_DIR } = require('../../shared');
const sessionState = require('../../session_state');
const { parentTaskDebt } = require('./parent_task_guard');
const { REASONS } = require('./work_checks/reasons');
const {
  isNothingMissedResponse,
  isBareCompletionMarker,
  scanSpeculation,
  isBroadCompletionPrompt,
  scanIncompleteCompletionClaims,
  scanNextActionDebt,
  scanWorkDebtAdmission,
} = require('./work_checks/scans');
const {
  lastAssistantText,
  assistantToolUsesSinceLastUserPrompt,
  lastRealUserPrompt,
} = require('./work_checks/transcript');
const { unfinishedTaskDebt } = require('./work_checks/task_debt');

const VERDICTS_FILE = path.join(RUNTIME_DIR, 'stop-detector-verdicts.env');
const COMPL_FILE = path.join(RUNTIME_DIR, 'completeness-injected.json');
const FP_GATE_ARMED_FLAG = path.join(RUNTIME_DIR, 'fp-gate-armed.flag');
const COMPL_MAX = 2;
const STARTUP_GRACE_MS = 90_000;

const DETECTOR_REGISTRY = JSON.parse(fs.readFileSync(
  path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'detectors', 'registry.json'),
  'utf8',
)).detectors;

function readVerdicts() {
  const out = {};
  for (const d of DETECTOR_REGISTRY) out[d.bash_var] = 'ok';
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

function isStartupGraceTurn(ctx) {
  const text = String(ctx.shared && ctx.shared.lastRealUserText || '').trim().toLowerCase();
  if (!['hi', 'hello', 'hey'].includes(text)) return false;
  const payload = ctx.payload || {};
  const startMs = Number(payload.session_start_time_ms || payload.start_time_ms || 0);
  return startMs <= 0 || Date.now() - startMs <= STARTUP_GRACE_MS;
}

function armFpGate(reason) {
  try {
    fs.mkdirSync(path.dirname(FP_GATE_ARMED_FLAG), { recursive: true });
    fs.writeFileSync(FP_GATE_ARMED_FLAG, JSON.stringify({
      ts: new Date().toISOString(),
      reason: String(reason || '').slice(0, 200),
    }));
  } catch (_e) { /* best-effort */ }
}

function loadComplStore() {
  try { return JSON.parse(fs.readFileSync(COMPL_FILE, 'utf8')); }
  catch (_e) { return {}; }
}

function saveComplStore(store) {
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

function latestWriteMs() {
  let latest = 0;
  for (const w of sessionState.readState().files_written) {
    const ts = Date.parse(w && w.ts || '');
    if (Number.isFinite(ts) && ts > latest) latest = ts;
  }
  return latest;
}

function hasSameTurnEvidence(turnStartMs) {
  const floor = Math.max(Number(turnStartMs) || 0, latestWriteMs() || 0);
  return sessionState.recentVerificationEvidence(30 * 60 * 1000).some((e) => {
    const ts = Date.parse(e && e.ts || '');
    if (!Number.isFinite(ts) || ts < floor) return false;
    const cmd = String(e && e.command || '').trim();
    const source = String(e && e.source || '');
    if (!cmd || !/^(PostToolUse:|tool_use:)/.test(source)) return false;
    if (e.exit_code !== null && e.exit_code !== undefined && e.exit_code !== 0) return false;
    return Boolean(e.artifact || e.excerpt || cmd);
  });
}

function transcriptPathFrom(ctx) {
  let transcriptPath = ctx.payload && ctx.payload.transcript_path;
  if (transcriptPath) return transcriptPath;
  try { return fs.readFileSync(path.join(PROJECT_ROOT, 'tmp', 'hme-transcript-path.txt'), 'utf8').trim(); }
  catch (_e) { return ''; }
}

function firingRulesFrom(verdicts) {
  return DETECTOR_REGISTRY
    .filter((d) => d.deny && verdicts[d.bash_var] === d.fires_when)
    .map((d) => ({
      name: d.reason_key || d.bash_var,
      reason: REASONS[d.reason_key] || REASONS[d.bash_var] || `${d.bash_var}: ${d.why || 'detector fired'}`,
    }));
}

function createState(ctx) {
  const transcriptPath = transcriptPathFrom(ctx);
  const lastUserInfo = lastRealUserPrompt(transcriptPath);
  const state = {
    ctx,
    transcriptPath,
    lastUserInfo,
    lastUser: lastUserInfo.text,
    firing: firingRulesFrom(readVerdicts()),
    _lastAssistant: null,
    lastAssistant() {
      if (this._lastAssistant === null) this._lastAssistant = lastAssistantText(this.transcriptPath);
      return this._lastAssistant;
    },
    deny(reasonKey, reason) {
      armFpGate(reasonKey);
      return this.ctx.deny(reason);
    },
  };
  return state;
}

const WORK_CHECKS = [
  { name: 'missing-user-prompt', evaluate(s) { return s.lastUser ? null : s.ctx.allow(); } },
  { name: 'startup-grace', evaluate(s) {
    s.ctx.shared = s.ctx.shared || {};
    s.ctx.shared.lastRealUserText = s.lastUser;
    return isStartupGraceTurn(s.ctx) ? s.ctx.allow() : null;
  } },
  { name: 'noise-prompt', evaluate(s) {
    const t = String(s.lastUser).trim().toLowerCase();
    return (!t || /^(?:undefined|null|continue|ok|k|standby|standing\s*by|\.|\?+|\s+)$/.test(t)) ? s.ctx.allow() : null;
  } },
  { name: 'detector-verdicts', evaluate(s) {
    if (s.firing.some((f) => f.name === 'CLAIM_WITHOUT_EVIDENCE') && hasSameTurnEvidence(s.lastUserInfo.tsMs)) {
      s.firing = s.firing.filter((f) => f.name !== 'CLAIM_WITHOUT_EVIDENCE');
    }
    if (s.firing.length === 1) return s.deny(s.firing[0].name, s.firing[0].reason);
    if (s.firing.length <= 1) return null;
    const header = `MULTI-FLAG STOP (${s.firing.length} detectors firing): ${s.firing.map((f) => f.name).join(', ')}.\nAddress all of them in this turn.\n\n`;
    const body = s.firing.map((f, i) => `--- [${i + 1}/${s.firing.length}] ${f.name} ---\n${f.reason}`).join('\n\n');
    return s.deny('MULTI_FLAG', header + body);
  } },
  { name: 'missing-transcript', evaluate(s) { return s.transcriptPath ? null : s.ctx.allow(); } },
  { name: 'unfinished-task-debt', evaluate(s) {
    const debt = unfinishedTaskDebt(s.transcriptPath);
    return debt ? s.deny('UNFINISHED_TASKS', debt) : null;
  } },
  { name: 'next-action-debt', evaluate(s) {
    const hits = scanNextActionDebt(s.lastAssistant());
    if (!hits.length) return null;
    const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
    return s.deny('NEXT_ACTION_DEBT', `${REASONS.NEXT_ACTION_DEBT}\n\n${enumerated}`);
  } },
  { name: 'work-debt-admission', evaluate(s) {
    const hits = scanWorkDebtAdmission(s.lastAssistant());
    if (!hits.length) return null;
    const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
    return s.deny('WORK_DEBT_ADMISSION', `${REASONS.WORK_DEBT_ADMISSION}\n\n${enumerated}`);
  } },
  { name: 'parent-task-debt', evaluate(s) {
    const debt = parentTaskDebt(s.transcriptPath);
    return debt ? s.deny('CORRECTION_PIVOT_PARENT_TASK', debt) : null;
  } },
  { name: 'completion-budget', evaluate(s) {
    s.turnKey = crypto.createHash('sha256').update(`${s.lastUserInfo.turnIndex}|${s.lastUser}`).digest('hex').slice(0, 16);
    s.store = loadComplStore();
    s.count = parseInt(s.store[s.turnKey], 10) || 0;
    if (s.count >= COMPL_MAX) return s.ctx.allow();
    s.next = s.count + 1;
    return null;
  } },
  { name: 'round-two-nothing-missed', evaluate(s) {
    if (s.next !== 2) return null;
    if (!isNothingMissedResponse(s.lastAssistant()) || unfinishedTaskDebt(s.transcriptPath)) return null;
    s.store[s.turnKey] = COMPL_MAX;
    saveComplStore(s.store);
    return s.ctx.allow();
  } },
  { name: 'bare-completion-marker', evaluate(s) {
    const bypass = isBareCompletionMarker(s.lastAssistant());
    const toolUses = assistantToolUsesSinceLastUserPrompt(s.transcriptPath);
    if (!bypass || toolUses !== 0) return null;
    return s.deny('FP_GATE_SUBVERSION',
      'FP-GATE SUBVERSION DETECTED: your last reply was a bare completion marker ([SUCCESS] / [OK] / k. / etc.) with zero tool calls since the most recent user prompt. The fp-gate marker is reserved for turns where the requested work is actually done -- using it to short-circuit an AUTO-COMPLETENESS CHECK is fraud. Resume the work the user asked for and emit a tool call. The completeness counter is NOT advanced by this denial; another bare marker reply will hit this same gate.'
    );
  } },
  { name: 'advance-completeness-counter', evaluate(s) {
    s.store[s.turnKey] = s.next;
    saveComplStore(s.store);
    return null;
  } },
  { name: 'broad-completion-debt', evaluate(s) {
    if (s.next !== 1 || !isBroadCompletionPrompt(s.lastUser)) return null;
    const hits = scanIncompleteCompletionClaims(s.lastAssistant());
    if (!hits.length) return null;
    const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
    return s.deny('BROAD_SCOPE_COMPLETION_DEBT', `${REASONS.COMPL_ROUND_1}\n\nBROAD-SCOPE COMPLETION DEBT: the user asked for comprehensive completion, but the last response used incomplete-status language. Do not stop at a status correction. Convert the broad request into explicit repo-verifiable criteria, implement the remaining items, run verification, and only then close.\n\n${enumerated}`);
  } },
  { name: 'speculation-debt', evaluate(s) {
    if (s.next !== 1) return null;
    const hits = scanSpeculation(s.lastAssistant());
    if (!hits.length) return null;
    const enumerated = hits.map((x, i) => `  ${i + 1}. "${x}"`).join('\n');
    return s.deny('SPECULATION_DEBT', `${REASONS.COMPL_ROUND_1}\n\nSPECULATION-DEBT SCAN: your last response contained ${hits.length} speculation-shaped phrase(s). Each must resolve to evidence (grep/Read the relevant code and either confirm or refute) or be dropped before stopping. NEVER leave speculation as a parting note -- it becomes permanent fog otherwise.\n\n${enumerated}`);
  } },
  { name: 'auto-completeness', evaluate(s) {
    return s.next === 1 ? s.deny('COMPL_ROUND_1', REASONS.COMPL_ROUND_1) : s.deny('COMPL_ROUND_2', REASONS.COMPL_ROUND_2);
  } },
];

module.exports = {
  name: 'work_checks',
  async run(ctx) {
    const state = createState(ctx);
    for (const check of WORK_CHECKS) {
      const result = check.evaluate(state);
      if (result) return result;
    }
    return ctx.allow();
  },
  _testables: {
    isNothingMissedResponse,
    isBareCompletionMarker,
    assistantToolUsesSinceLastUserPrompt,
    REASONS,
    WORK_CHECKS,
  },
};
