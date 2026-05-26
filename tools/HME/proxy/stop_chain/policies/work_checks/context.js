'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT, RUNTIME_DIR } = require('../../../shared');
const sessionState = require('../../../session_state');
const { assistantToolUsesSinceLastUserPrompt } = require('./transcript');
const { REASONS } = require('./reasons');
const { lastAssistantText: readLastAssistantText, lastRealUserPrompt } = require('./transcript');

const VERDICTS_FILE = path.join(RUNTIME_DIR, 'stop-detector-verdicts.env');
const COMPL_FILE = path.join(RUNTIME_DIR, 'completeness-injected.json');
const FP_GATE_ARMED_FLAG = path.join(RUNTIME_DIR, 'fp-gate-armed.flag');
const COMPL_MAX = 2;

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
  const transcriptPath = ctx.payload && ctx.payload.transcript_path;
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

function completionTurnKey(lastUserInfo, lastUser) {
  return crypto.createHash('sha256')
    .update(`${lastUserInfo.turnIndex}|${lastUser}`)
    .digest('hex')
    .slice(0, 16);
}

function buildWorkCheckContext(ctx) {
  const transcriptPath = transcriptPathFrom(ctx);
  const lastUserInfo = lastRealUserPrompt(transcriptPath);
  const state = {
    ctx,
    transcriptPath,
    lastUserInfo,
    lastUser: lastUserInfo.text,
    firing: firingRulesFrom(readVerdicts()),
    toolUseCount: assistantToolUsesSinceLastUserPrompt(transcriptPath),
    hasSameTurnEvidence: hasSameTurnEvidence(lastUserInfo.tsMs),
    _lastAssistantText: null,
    lastAssistant() { return this.lastAssistantText; },
    deny(reasonKey, reason) {
      armFpGate(reasonKey);
      return this.ctx.deny(reason);
    },
  };
  Object.defineProperty(state, 'lastAssistantText', {
    enumerable: true,
    get() {
      if (this._lastAssistantText === null) {
        this._lastAssistantText = readLastAssistantText(this.transcriptPath);
      }
      return this._lastAssistantText;
    },
  });
  return state;
}

module.exports = {
  COMPL_MAX,
  REASONS,
  buildWorkCheckContext,
  completionTurnKey,
  hasSameTurnEvidence,
  loadComplStore,
  saveComplStore,
};
