'use strict';
/**
 * Pure-JS port of work_checks.sh -- STOP_WORK / EXHAUST_CHECK gates plus
 * the AUTO-COMPLETENESS INJECT counter. Verdicts come from the verdicts
 * file; the enforcement reminder still goes to stderr; the inject counter
 * lives in tools/HME/runtime/completeness-injected.json (50-entry cap, FIFO eviction).
 *
 * MUST RUN AFTER: detectors
 * MUST RUN BEFORE: holograph, post_hooks
 * COORDINATES WITH: anti_patterns
 *
 * Relies on the verdicts file populated by `detectors`; emits the auto-
 * completeness inject before holograph snapshots the closing state.
 * Coordinates with anti_patterns because both consume the same verdicts
 * file and the first-deny-wins behavior depends on order.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { PROJECT_ROOT, RUNTIME_DIR } = require('../../shared');
const sessionState = require('../../session_state');
const { parentTaskDebt } = require('./parent_task_guard');

const VERDICTS_FILE = path.join(RUNTIME_DIR, 'stop-detector-verdicts.env');
const COMPL_FILE = path.join(RUNTIME_DIR, 'completeness-injected.json');
const FP_GATE_ARMED_FLAG = path.join(RUNTIME_DIR, 'fp-gate-armed.flag');
const COMPL_MAX = 2;
const STARTUP_GRACE_MS = 90_000;

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

const REASONS = {
  STOP_WORK_DISMISSIVE:
    'STOP-WORK ANTIPATTERN: You responded with dismissive text instead of doing work. Re-read the user prompt and the conversation. There is always pending work after a user message -- find it and do it. If genuinely nothing remains, explain what was completed and why. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  STOP_WORK_TEXT_ONLY:
    'STOP-WORK ANTIPATTERN: Your last turn was a short text-only response with no tool calls. If there is remaining work, continue it now. If you genuinely completed everything, provide a substantive summary of what was done. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  EXHAUST:
    'EXHAUST PROTOCOL VIOLATION: Final text enumerated remaining items (TBD/noted/remaining tools) without fixing them. Every enumerated item must be fixed in the same turn. Resume and implement the highest-leverage items now. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SCOPE_ESCAPE:
    'SCOPE-ESCAPE VIOLATION: Final text dismissed a problem by labeling it pre-existing / unrelated / not-introduced-here / out-of-scope-of-this-turn instead of fixing it. The rule is: if you saw it, fix it. "Pre-existing" is not a permission slip to skip work. Either (a) fix the problem in this turn, or (b) if fixing is genuinely wrong (e.g. would break an unrelated boundary), say so explicitly and explain why fixing is the wrong move -- do NOT just label-and-stop. The rescue clause "and I fixed it" / "now resolved" suppresses this gate, so the path forward is always to fix. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SCOPE_STACKED:
    'SCOPE-STACKED ANTIPATTERN: New `- [ ]` items were added to doc/templates/TODO.md this turn but zero `[ ]` -> `[x]` transitions happened. Translation: you enumerated MORE work than you DID. TODO.md is growing faster than artifacts. Either (a) implement the highest-leverage new item right now and tick it, or (b) revert the TODO additions if they were premature scope-stacking. Naming work is not equivalent to shipping work. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SCOPE_NOT_TRACKED:
    'SCOPE-NOT-TRACKED ANTIPATTERN: This turn made substantive Edit/Write/MultiEdit calls to non-TODO files but zero TODO items were ticked. Either (a) tick the TODO item(s) the work corresponds to, or (b) update TODO.md to reflect the new scope the work actually addressed. Work happening off declared scope is silent scope drift. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  EVASION_INTENT:
    'EVASION-INTENT ANTIPATTERN: Your thinking blocks contained explicit gate-evasion language (e.g. "avoid the structural check", "frame in prose to bypass", "stay under the threshold", "to avoid exhaust_check"). Gates exist to enforce the work. Routing around a gate IS routing around the work the gate enforces. Meet the gate intent honestly: either do the work the gate is asking for, or push back on the gate explicitly with a reason. Do NOT shape output to fall just under a threshold. Re-read the matched phrases via i/why mode=block. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHANTOM_CAPABILITY:
    'PHANTOM CAPABILITY: Your closing summary declared a thinking/delegation capability that is NOT in the closed enumeration at tools/HME/scripts/detectors/_capability_enum.py. Inventing generic labels ("decomposition", "tradeoff analysis", "deep reasoning") is a CRITICAL FAILURE -- it does NOT contribute to the tier floor. Either (a) replace the declaration with a verbatim name from the enumeration, (b) anchor the declaration with verification evidence (`(verified)`, code-quoted output, tool-call trace) within 240 chars after the name, or (c) drop the declaration. New capabilities are added by editing _capability_enum.py and bumping ENUMERATION_VERSION -- never by ad-hoc invention at run time. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHANTOM_PARAPHRASE:
    'PHANTOM PARAPHRASE (soft): Your text contained a paraphrase of a real capability (e.g. "first-principles decomposition" instead of "FirstPrinciples"). This is the shape of an agent reaching for an enumeration name without committing. Rewrite using the verbatim name from _capability_enum.py, OR drop the language if you did not actually invoke that capability. Soft flag -- does not block, but the meta-detector tracks the rate. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_MISSING_PRE_BUILD:
    'ADVISOR DOCTRINE (legacy): Tier >= E2 work just hit a BUILD/commit boundary without an advisor record. The legacy advisor toolchain has been removed; either continue with the work and state the solo rationale, or escalate to the user if real external review is needed. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_MISSING_POST_DELIVER:
    'ADVISOR DOCTRINE (legacy): A durable deliverable landed without an advisor record. The legacy advisor toolchain has been removed; either continue with the work and state the solo rationale, or escalate to the user if real external review is needed. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_SILENTLY_SKIPPED:
    'ADVISOR DOCTRINE (legacy E4/E5 floor): Tier >= E4 work completed with no advisor record and no solo-rationale clause. The legacy advisor toolchain has been removed; continue with the work, state why solo execution is appropriate, or escalate to the user if review is truly needed. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_CONFLICT_CAP:
    'ADVISOR DOCTRINE (Rule 3 -- conflict cap): The advisor was re-called more than 2 times on the same conflict_id (see tmp/hme-advisor-conflicts.jsonl). Hard cap exceeded. Escalate to the user instead of re-calling -- keep the loop bounded. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SUMMARY_MISSING:
    'STOP-THE-LINE FORMAT VIOLATION: Tier E5 (Comprehensive) work closed without the required SUMMARY block. Append the closing block before stopping. Required fields: [ITERATION], [CONTENT], [STORY] (4 bullets: problem | what we did | how it went | what\'s next), and [VOICE] <name>: <8-16 word summary>. Either (a) emit the block now, or (b) re-classify the tier -- if no summary is needed, this work was lighter than E5 and the classifier should reflect that. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SUMMARY_MALFORMED:
    'STOP-THE-LINE FORMAT VIOLATION: Closing summary block is present but missing required fields. Every E5 turn must include all 7 elements: SUMMARY banner, [ITERATION]:, [CONTENT]:, [STORY]: with all 4 bullets (problem, what we did, how it went, what\'s next), and [VOICE] <name>: <8-16 word closing line>. Re-emit the block with every field populated. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHASE_SKIPPED:
    'PHASE GATE VIOLATION: Tier >= E3 (Algorithm) work made Edit/Write/MultiEdit calls this turn without declaring a BUILD or EXECUTE phase first. The 7-phase loop (OBSERVE -> THINK -> PLAN -> BUILD -> EXECUTE -> VERIFY -> LEARN) requires explicit transition markers so the design intent is articulated before code lands. Either (a) emit "BUILD" or "phase: build" in your text before the next edit, or (b) re-classify the tier -- if no PLAN ceremony is needed, this work was lighter than E3. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  MINIMAL_FORMAT_VIOLATION:
    'MINIMAL MODE FORMAT VIOLATION: The classifier detected a MINIMAL-mode prompt (one-line acknowledgment expected) but your response was long-form OR carried an ALGORITHM-style SUMMARY block. Match the mode: terse one-liner, no boilerplate. If the work was actually substantive (warranting NATIVE/ALGORITHM), ask the classifier to re-evaluate or escalate the tier explicitly. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PILE_ON:
    'PILE-ON ANTIPATTERN: This turn edited 2+ detector / policy / hook files. Endless rule-stacking is itself the failure mode -- each detector firing produces another rule edit, each rule edit creates new firings, the cycle accumulates ceremony without resolving the underlying issue. STOP editing detectors. The fix for a noisy detector firing is rarely another rule; usually the right move is discretion (let the imperfect rule fire, continue the actual work). If a real detector bug exists, fix THAT specific bug and stop -- do not also tighten three neighboring detectors in the same turn. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SPIRALLING_PETULANCE:
    'SPIRALLING_PETULANCE: The transcript shows repeated no-op resistance after corrective hook feedback, repeated inert Bash no-ops, or repeated failed Reads. Stop answering the gate with a dot/empty command/retry loop. Do the concrete corrective action once: modify the target file/state the hook names, verify it, then stop.',
  FLABBERGASTED_BY_AUTOCOMMIT:
    'FLABBERGASTED_BY_AUTOCOMMIT: Autocommit already consumed the diff, but the transcript kept probing clean git status/diff/log output. Do not spiral on where the diff went. Trust the autocommit evidence, inspect once if needed, verify the actual artifact, then stop.',
  CLAIM_WITHOUT_EVIDENCE:
    "VERIFICATION DOCTRINE (Iron Law): Final text claimed completion (`tests pass`, `lands`, `live at`, `now works`, `verified`, etc.) WITHOUT a same-turn evidence-producing tool call. Claim without verification is dishonesty, not efficiency. Either (a) run the verification command NOW (Bash test/curl/build/probe, or Read of the claimed-modified file) and re-emit the claim WITH the evidence inline, or (b) drop the claim language and state actual status (e.g. `code change made; not yet verified`). The phrase `should pass`, `probably works`, or `looks correct` is also a violation -- evidence before claims, always. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.",
  NEXT_ACTION_DEBT:
    'NEXT-ACTION DEBT: Final text admitted remaining work with next-action / next-step language. Do not stop after naming the next action. Execute it now, or explicitly mark it impossible/blocked with evidence and ask the user. Acknowledging the gap is not repair.',
  WORK_DEBT_ADMISSION:
    'WORK-DEBT ADMISSION: Final text admitted incomplete/remaining/pending work, enumerated work to do, or dispatched work into a future step instead of executing it. This is a hard stop: do the named work now, or explicitly prove it is impossible/unsafe with evidence and ask the user. Acknowledgement and enumeration are not work.',
  UNFINISHED_TASKS:
    'UNFINISHED TASK-LIST VIOLATION: The active task list still contains pending or in_progress items. Do not end the turn with open tasks. Complete them now, or if a task is genuinely obsolete, update/delete it with an explicit task tool before stopping. Acknowledgement text is not completion evidence.',
  FIX_WITHOUT_INVESTIGATION:
    'SYSTEMATIC-DEBUGGING PHASE GATE: User reported a bug / broken behavior / failure, and your turn made Edit/Write/MultiEdit calls WITHOUT a prior investigation-shape tool call (Read/Grep/Glob/Bash with grep/cat/log/git-diff/i-status/curl-health/etc.). NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. The fastest path to a real fix is: reproduce the symptom, trace the causal chain, identify the failing component, THEN edit. Skipping straight to a guessed fix produces symptom-patching (the next bug surfaces in the same area within hours). Either (a) investigate now -- read the relevant logs/code/state, then propose the fix with the causal chain stated, or (b) explicitly note this was a one-line obvious fix (typo, clear stack-trace pointer) where investigation would be ceremony. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  COMMENT_BLOAT:
    'COMMENT-BLOAT VIOLATION (doc/templates/AGENTS.md): A file you edited this turn contains a 5+ line consecutive inline-comment block. Rule: "Inline comments single-line and terse. Elaboration goes in doc/." Trim the block to <=2 lines OR move the explanation into doc/. Run `python3 tools/HME/scripts/audit-comment-bloat.py --files <path>` to see the offending blocks. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  BOYSCOUT_LOC:
    'LOC LIMIT VIOLATION (doc/templates/AGENTS.md): A file you Edited/Wrote this turn exceeds 350 LOC and is not in config/loc-ignore.txt. Rule: "Files MUST be <=350 LOC unless listed in loc-ignore.txt. Organize at logical boundaries." Either split the file, OR add to loc-ignore.txt with rationale. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  BOYSCOUT_CLEAN:
    'BOYSCOUT CLEAN-ROOM VIOLATION: A file you Edited/Wrote this turn still has audit violations. Every edited file must be left with ZERO errors (comment-bloat or char-spam). Fix the violations in the file(s) you touched this turn. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ORPHAN_REFERENCE:
    'ORPHAN REFERENCE: A file you DELETED this turn still has live references in source/scripts/docs. Sweep them: `grep -rln <stem> tools/ scripts/ src/ doc/` then either remove the references or restore the file. Deletion-without-cleanup is the bug class that produces broken imports / dead require paths / stale doc links. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  COMPL_ROUND_1:
    "AUTO-COMPLETENESS CHECK (round 1/2): If anything substantive is still unfinished from THIS TURN's work, finish it. If the work is complete, the next response may be empty or just the fp-gate marker when prompted. Do NOT write ceremony text, enumerated 'nothing missed' summaries, or rescue clauses just to satisfy this gate. Imperfect rules are OK; ceremony to dodge them is not.",
  COMPL_ROUND_2:
    "AUTO-COMPLETENESS CHECK (round 2/2 -- safety net): Last pass. If genuine substantive work remains, do it. If complete, the next response may be empty or just the fp-gate marker when prompted. No 'Nothing missed' boilerplate required.",
};

const ENFORCEMENT_REMINDER =
  'STOP. Re-read doc/templates/AGENTS.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.';

// anti-fork-begin: hook-inject-prefixes min=7
const HOOK_INJECT_PREFIXES = [
  'Stop hook feedback:',
  'AUTO-COMPLETENESS INJECT',
  '[ALERT] LIFESAVER',
  'NEXUS --',
  '[[HME_AGENT_TASK',
  'PreToolUse:',
  'PostToolUse:',
];
// anti-fork-end: hook-inject-prefixes

// Detector registry is the single source of truth (see registry.json doc).
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

function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return ''; }
  let last = '';
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'assistant') continue;
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
    if (text) last = text;
  }
  return last;
}

// Match exact "nothing missed"-shape no-op responses (<=80 chars, equals one
// of the declarations). Long responses with the phrase mid-sentence don't match.
function isNothingMissedResponse(text) {
  if (!text) return false;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 80) return false;  // long responses always run round 2
  const re = /^(nothing\s+missed|confirmed\s+nothing\s+(missed|remains|left)|nothing\s+remains|all\s+(set|done|clear))[.!]?$/i;
  return re.test(trimmed);
}

// anti-fork-begin: speculation-regexes min=6
const SPECULATION_RES = [
  /\bi\s+(worry|suspect|imagine|wonder|guess|think\s+(that|maybe))\b[^.!?\n]{1,120}/gi,
  /\b(this|that|it)\s+(might|may|could)\s+(be|have|cause|break|miss)\b[^.!?\n]{1,120}/gi,
  /\b(probably|likely|presumably|seems?\s+like|appears?\s+to)\b[^.!?\n]{1,120}/gi,
  /\b(worth\s+(investigating|verifying|checking|confirming|exploring)|might\s+be\s+worth)\b[^.!?\n]{1,120}/gi,
  /\b(open\s+question|outstanding\s+question|haven'?t\s+verified)\b[^.!?\n]{1,120}/gi,
  /\b(my\s+(concern|worry)|the\s+concern\s+(is|here))\b[^.!?\n]{1,120}/gi,
];
// anti-fork-end: speculation-regexes

function scanSpeculation(text) {
  if (!text) return [];
  // Strip code fences + backticks + quoted spans before scanning so
  // documentation/examples don't false-fire.
  let stripped = text.replace(/```[\s\S]*?```/g, ' ');
  stripped = stripped.replace(/`[^`\n]*`/g, ' ');
  stripped = stripped.replace(/"[^"\n]*"/g, ' ');
  stripped = stripped.replace(/'[^'\n]*'/g, ' ');
  const seen = new Set();
  const hits = [];
  for (const re of SPECULATION_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      const snippet = m[0].trim().replace(/\s+/g, ' ').slice(0, 120);
      const key = snippet.toLowerCase().slice(0, 40);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push(snippet);
      if (hits.length >= 5) break;
    }
    if (hits.length >= 5) break;
  }
  return hits;
}

function isBroadCompletionPrompt(text) {
  return /\b(do\s+all|all\s+fully|complete\s+fully|complete\s+all|full\s+list|entire\s+list|everything|anything\s+missing|all\s+suggestions|complete\s+the\s+suggestions|does\s+that\s+complete\s+all|are\s+all\s+\d+|completion\s+for\s+the\s+\d+(st|nd|rd|th)\s+time)\b/i.test(text || '');
}

function scanIncompleteCompletionClaims(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\b(partial|not\s+complete|not\s+done|remaining|still\s+needs?|todo|pending|scaffold|foundation|next\s+(step|action)|would\s+need)\b[^.!?\n]{0,120}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

function scanNextActionDebt(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\bnext\s+(action|step)\s+(is|would\s+be|will\s+be|should\s+be|remains?|needed|to\s+do)\b[^.!?\n]{0,160}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 4) break;
  }
  return out;
}

function scanWorkDebtAdmission(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const safeNegation = /\b(no|zero|nothing)\s+(remaining|remains|left|pending|open|outstanding|unfinished|incomplete)\b/i;
  const re = /\b(not\s+(complete|done|finished|closed)|does(?:n['’]?t|\s+not)\s+complete|not\s+fully\s+(complete|closed|done)|remaining\s+(work|gap|gaps|item|items|issue|issues|todo|todos|finding|findings|violation|violations|offender|offenders)|still\s+(needs?|pending|open|outstanding|unfinished|incomplete)|pending\s+(work|item|items|todo|todos|fix|fixes)|follow-?up\s+(needed|required|remains?)|limitation\s*:|not\s+completed\s+from|before\s+.*diversion|resume\s+exactly\s+there|(?:i['’]?m|i\s+am|i\s+will|i['’]?ll|we\s+will)\s+(fixing|going\s+to|running|patching|continuing|executing|doing|checking|verifying)|(?:fixing|patching|running|continuing|executing|doing|checking|verifying)\s+(now|next|that|this|the))\b[^.!?\n]{0,180}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (!s || safeNegation.test(s)) continue;
    out.push(s);
    if (out.length >= 6) break;
  }
  return out;
}

function entryTimestampMs(entry) {
  const raw = entry && (entry.timestamp || entry.created_at || entry.time || entry.ts);
  if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function lastRealUserPrompt(transcriptPath) {
  if (!transcriptPath) return { text: '', turnIndex: 0, tsMs: 0 };
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return { text: '', turnIndex: 0, tsMs: 0 }; }
  let last = '';
  let lastTurnIndex = 0;
  let lastTsMs = 0;
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
    // Each user message = distinct turn; COMPL counter dedups per turnIndex
    // so identical-text repeats each get fresh budget.
    turnIndex++;
    last = text;
    lastTurnIndex = turnIndex;
    lastTsMs = entryTimestampMs(entry) || lastTsMs;
  }
  return { text: last, turnIndex: lastTurnIndex, tsMs: lastTsMs };
}

function loadComplStore() {
  try { return JSON.parse(fs.readFileSync(COMPL_FILE, 'utf8')); }
  catch (_e) { return {}; }
}

function saveComplStore(store) {
  // Cap at 50 entries -- drop oldest by insertion order (object iteration order).
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
  const writeMs = latestWriteMs();
  const floor = Math.max(Number(turnStartMs) || 0, writeMs || 0);
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

function _entryText(entry) {
  const content = (entry && entry.message && entry.message.content) || (entry && entry.content);
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (!b) return '';
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.text) return b.text;
      if (b.content && typeof b.content === 'string') return b.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

function isStructuredTaskReminderLine(trimmed) {
  if (/^#\d+\.?\s*\[(?:in_progress|pending)\]/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?id:\s*\S+\b.*\bstatus:\s*(?:in_progress|pending)\b/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?status:\s*(?:in_progress|pending)\b.*\b(subject|description|content|activeForm):/i.test(trimmed)) return true;
  if (/^(?:[-*]\s*)?(subject|description|content|activeForm):\s*\S+\b.*\bstatus:\s*(?:in_progress|pending)\b/i.test(trimmed)) return true;
  return false;
}

function scanUnfinishedTaskReminder(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const hits = [];
  let inStopHookPayload = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(Stop hook feedback:|Stop hook blocking error from command:|STOP-CHAIN INTEGRITY FAILURE:|---)$/.test(trimmed)
      || /^--- \[\d+\/\d+\]/.test(trimmed)) {
      inStopHookPayload = true;
      continue;
    }
    if (inStopHookPayload) {
      if (/^\s*(Carried-over HME todos|Here are the existing tasks|TaskList|#\d+\.?\s*\[(?:in_progress|pending)\])/i.test(trimmed)) inStopHookPayload = false;
      else if (/UNFINISHED TASK-LIST VIOLATION|Open task evidence:|\{\"decision\":\"block\",\"reason\":\"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
      else if (/^\d+\.\s*\d+:\[\d{4}-\d{2}-\d{2}T.*\[proxy-supervisor\]/.test(trimmed)) continue;
    }
    if (/^\d+\s+\{\"decision\":\"block\",\"reason\":\"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (/^stdout\s+\{\"decision\":\"block\",\"reason\":\"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (/\{\"decision\":\"block\",\"reason\":\"UNFINISHED TASK-LIST VIOLATION:/i.test(trimmed)) continue;
    if (!/\b(in_progress|pending)\b/i.test(trimmed)) continue;
    if (!isStructuredTaskReminderLine(trimmed)) continue;
    hits.push(trimmed.slice(0, 240));
    if (hits.length >= 6) break;
  }
  return hits;
}

function unfinishedTaskDebtFromTranscript(transcriptPath) {
  if (!transcriptPath) return [];
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return []; }
  let debt = [];
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'user') continue;
    const text = _entryText(entry);
    if (!text) continue;
    const looksTaskReminder = /Here are the existing tasks|TaskList|task list|existing tasks/i.test(text);
    if (!looksTaskReminder && !/<system-reminder>[\s\S]*\b(in_progress|pending)\b/i.test(text)) continue;
    const hits = scanUnfinishedTaskReminder(text);
    if (hits.length) debt = hits;
  }
  return debt;
}

function _assistantToolUses(entry) {
  const content = (entry && entry.message && entry.message.content) || (entry && entry.content);
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && typeof b === 'object' && b.type === 'tool_use');
}

function _todoLine(todo, fallbackId) {
  const status = String(todo && todo.status || '').trim();
  if (status !== 'pending' && status !== 'in_progress') return '';
  const text = String(
    todo.content || todo.activeForm || todo.subject || todo.description || todo.text || `task ${fallbackId}`
  ).replace(/\s+/g, ' ').trim();
  return `[${status}] ${text}`.trim().slice(0, 240);
}

function unfinishedTaskDebtFromTodoWrite(transcriptPath) {
  if (!transcriptPath) return [];
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return []; }
  let latestTodos = null;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'assistant') continue;
    for (const block of _assistantToolUses(entry)) {
      if (block.name !== 'TodoWrite') continue;
      const todos = block.input && Array.isArray(block.input.todos) ? block.input.todos : null;
      if (todos) latestTodos = todos;
    }
  }
  if (!latestTodos) return [];
  const debt = [];
  latestTodos.forEach((todo, i) => {
    const line = _todoLine(todo, i + 1);
    if (line) debt.push(line);
  });
  return debt.slice(0, 6);
}

function sessionIdFromTranscriptPath(transcriptPath) {
  const base = path.basename(String(transcriptPath || ''));
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m ? m[1] : '';
}

function _taskStoreRoots() {
  const roots = [];
  const home = process.env.HOME || os.homedir();
  if (home) roots.push(path.join(home, '.claude', 'tasks'));
  const config = process.env.CLAUDE_CONFIG_DIR;
  if (config) roots.push(path.join(config, 'tasks'));
  return [...new Set(roots.map((p) => path.resolve(p)))];
}

function unfinishedTaskDebtFromStore(transcriptPath) {
  const sessionId = sessionIdFromTranscriptPath(transcriptPath);
  if (!sessionId) return [];
  const debt = [];
  for (const root of _taskStoreRoots()) {
    const dir = path.join(root, sessionId);
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (_e) { continue; }
    for (const ent of entries) {
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      let task;
      try { task = JSON.parse(fs.readFileSync(path.join(dir, ent.name), 'utf8')); }
      catch (_e) { continue; }
      const status = String(task && task.status || '').trim();
      if (status !== 'pending' && status !== 'in_progress') continue;
      const id = String(task.id || ent.name.replace(/\.json$/, '')).trim();
      const subject = String(task.subject || task.description || task.content || '').replace(/\s+/g, ' ').trim();
      debt.push(`#${id} [${status}] ${subject}`.trim().slice(0, 240));
      if (debt.length >= 6) return debt;
    }
  }
  return debt;
}

function unfinishedTaskDebt(transcriptPath) {
  const debt = unfinishedTaskDebtFromStore(transcriptPath).concat(
    unfinishedTaskDebtFromTranscript(transcriptPath),
    unfinishedTaskDebtFromTodoWrite(transcriptPath),
  );
  if (!debt.length) return null;
  return `${REASONS.UNFINISHED_TASKS}\n\nOpen task evidence:\n${debt.map((s, i) => `  ${i + 1}. ${s}`).join('\n')}`;
}

module.exports = {
  name: 'work_checks',
  async run(ctx) {
    const v = readVerdicts();
    const FIRING_RULES = DETECTOR_REGISTRY
      .filter((d) => d.deny)
      .map((d) => [d.bash_var, d.fires_when, d.reason_key]);
    const willDeny = FIRING_RULES.some(([f, val]) => v[f] === val);
    let firing = [];
    for (const [field, value, reasonKey] of FIRING_RULES) {
      if (v[field] === value) firing.push({ name: reasonKey || field, reason: REASONS[reasonKey] || REASONS[field] });
    }
    let transcriptPath = ctx.payload && ctx.payload.transcript_path;
    if (!transcriptPath) {
      try {
        transcriptPath = fs.readFileSync(path.join(PROJECT_ROOT, 'tmp', 'hme-transcript-path.txt'), 'utf8').trim();
      } catch(_) {}
    }
    const lastUserInfo = lastRealUserPrompt(transcriptPath);
    const { text: lastUser, turnIndex } = lastUserInfo;
    if (!lastUser) return ctx.allow();
    ctx.shared.lastRealUserText = lastUser;
    if (isStartupGraceTurn(ctx)) return ctx.allow();
    if (firing.some((f) => f.name === 'CLAIM_WITHOUT_EVIDENCE') && hasSameTurnEvidence(lastUserInfo.tsMs)) {
      firing = firing.filter((f) => f.name !== 'CLAIM_WITHOUT_EVIDENCE');
    }
    if (firing.length === 1) {
      armFpGate(firing[0].name); return ctx.deny(firing[0].reason);
    }
    if (firing.length > 1) {
      const header = `MULTI-FLAG STOP (${firing.length} detectors firing): ${firing.map((f) => f.name).join(', ')}.\nAddress all of them in this turn.\n\n`;
      const body = firing.map((f, i) => `--- [${i + 1}/${firing.length}] ${f.name} ---\n${f.reason}`).join('\n\n');
      armFpGate('MULTI_FLAG'); return ctx.deny(header + body);
    }

    if (!transcriptPath) return ctx.allow();
    const taskDebt = unfinishedTaskDebt(transcriptPath);
    if (taskDebt) { armFpGate('UNFINISHED_TASKS'); return ctx.deny(taskDebt); }
    const lastAssistant = lastAssistantText(transcriptPath);
    const nextActionDebt = scanNextActionDebt(lastAssistant);
    if (nextActionDebt.length > 0) {
      const enumerated = nextActionDebt.map((s, i) => `  ${i + 1}. "${s}"`).join('\n');
      armFpGate('NEXT_ACTION_DEBT');
      return ctx.deny(`${REASONS.NEXT_ACTION_DEBT}\n\n${enumerated}`);
    }
    const workDebt = scanWorkDebtAdmission(lastAssistant);
    if (workDebt.length > 0) {
      const enumerated = workDebt.map((s, i) => `  ${i + 1}. "${s}"`).join('\n');
      armFpGate('WORK_DEBT_ADMISSION');
      return ctx.deny(`${REASONS.WORK_DEBT_ADMISSION}\n\n${enumerated}`);
    }
    const parentDebt = parentTaskDebt(transcriptPath);
    if (parentDebt) { armFpGate('CORRECTION_PIVOT_PARENT_TASK'); return ctx.deny(parentDebt); }

    // Dedup key = turnIndex+text so identical retypes get separate budgets.
    const turnKey = crypto.createHash('sha256')
      .update(`${turnIndex}|${lastUser}`)
      .digest('hex').slice(0, 16);
    const store = loadComplStore();
    const count = parseInt(store[turnKey], 10) || 0;
    if (count >= COMPL_MAX) return ctx.allow();

    const next = count + 1;
    // Round-2 skip if round-1 response was a clean "nothing missed" no-op
    // (advance counter to MAX, return allow). Round 1 always fires.
    if (next === 2) {
      const lastAssistant = lastAssistantText(transcriptPath);
      if (isNothingMissedResponse(lastAssistant) && !unfinishedTaskDebt(transcriptPath)) {
        store[turnKey] = COMPL_MAX;
        saveComplStore(store);
        return ctx.allow();
      }
    }
    store[turnKey] = next;
    saveComplStore(store);

    if (next === 1) {
      const lastAssistant = lastAssistantText(transcriptPath);
      if (isBroadCompletionPrompt(lastUser)) {
        const incomplete = scanIncompleteCompletionClaims(lastAssistant);
        if (incomplete.length > 0) {
          const enumerated = incomplete.map((s, i) => `  ${i + 1}. "${s}"`).join('\n');
          armFpGate('BROAD_SCOPE_COMPLETION_DEBT');
          return ctx.deny(
            `${REASONS.COMPL_ROUND_1}\n\n` +
            `BROAD-SCOPE COMPLETION DEBT: the user asked for comprehensive completion, ` +
            `but the last response used incomplete-status language. Do not stop at a ` +
            `status correction. Convert the broad request into explicit repo-verifiable ` +
            `criteria, implement the remaining items, run verification, and only then ` +
            `close.\n\n${enumerated}`
          );
        }
      }
      const specs = scanSpeculation(lastAssistant);
      if (specs.length > 0) {
        const enumerated = specs.map((s, i) => `  ${i + 1}. "${s}"`).join('\n');
        const targeted =
          `${REASONS.COMPL_ROUND_1}\n\n` +
          `SPECULATION-DEBT SCAN: your last response contained ${specs.length} ` +
          `speculation-shaped phrase(s). Each must resolve to evidence ` +
          `(grep/Read the relevant code and either confirm or refute) or be ` +
          `dropped before stopping. NEVER leave speculation as a parting ` +
          `note -- it becomes permanent fog otherwise.\n\n` +
          enumerated;
        armFpGate('SPECULATION_DEBT'); return ctx.deny(targeted);
      }
      armFpGate('COMPL_ROUND_1'); return ctx.deny(REASONS.COMPL_ROUND_1);
    }
    armFpGate('COMPL_ROUND_2'); return ctx.deny(REASONS.COMPL_ROUND_2);
  },
};
