'use strict';
/**
 * Pure-JS port of work_checks.sh -- STOP_WORK / EXHAUST_CHECK gates plus
 * the AUTO-COMPLETENESS INJECT counter. Verdicts come from the verdicts
 * file; the enforcement reminder still goes to stderr; the inject counter
 * lives in runtime/hme/completeness-injected.json (50-entry cap, FIFO eviction).
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
const crypto = require('crypto');
const { PROJECT_ROOT, RUNTIME_DIR } = require('../../shared');
const sessionState = require('../../session_state');

const VERDICTS_FILE = path.join(RUNTIME_DIR, 'stop-detector-verdicts.env');
const COMPL_FILE = path.join(RUNTIME_DIR, 'completeness-injected.json');
const FP_GATE_ARMED_FLAG = path.join(RUNTIME_DIR, 'fp-gate-armed.flag');
const COMPL_MAX = 2;
const STARTUP_GRACE_MS = 90_000;

function isStartupGraceTurn(ctx) {
  const payload = ctx.payload || {};
  const transcript = payload.transcript_path || '';
  if (!transcript) return false;
  const startMs = Number(payload.session_start_time_ms || payload.start_time_ms || 0);
  if (startMs > 0 && Date.now() - startMs > STARTUP_GRACE_MS) return false;
  const text = String(ctx.shared && ctx.shared.lastRealUserText || '').trim().toLowerCase();
  return text === 'hi' || text === 'hello' || text === 'hey';
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
  LIVE_PROBE_MISSING:
    'LIVE-PROBE VIOLATION (PAI Verification Doctrine Rule 1): An ISA you edited this turn now has [x] criteria without corresponding entries in the Verification section. Every ISC marked done MUST carry tool-probe evidence (command output, Read content, screenshot) in the same ISA\'s Verification block. Either (a) add the Verification entry now -- one row per [x] ISC with the probe evidence -- or (b) revert the [x] back to [ ] / [DEFERRED-VERIFY:<task>] until the probe runs. The audit at tools/HME/scripts/isa/audit-isa.py reports the specific unverified ISC ids. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHASE_SKIPPED:
    'PHASE GATE VIOLATION: Tier >= E3 (Algorithm) work made Edit/Write/MultiEdit calls this turn without declaring a BUILD or EXECUTE phase first. The 7-phase loop (OBSERVE -> THINK -> PLAN -> BUILD -> EXECUTE -> VERIFY -> LEARN) requires explicit transition markers so the design intent is articulated before code lands. Either (a) emit "BUILD" or "phase: build" in your text before the next edit, or (b) re-classify the tier -- if no PLAN ceremony is needed, this work was lighter than E3. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  MINIMAL_FORMAT_VIOLATION:
    'MINIMAL MODE FORMAT VIOLATION: The classifier detected a MINIMAL-mode prompt (one-line acknowledgment expected) but your response was long-form OR carried an ALGORITHM-style SUMMARY block. Match the mode: terse one-liner, no boilerplate. If the work was actually substantive (warranting NATIVE/ALGORITHM), ask the classifier to re-evaluate or escalate the tier explicitly. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PILE_ON:
    'PILE-ON ANTIPATTERN: This turn edited 2+ detector / policy / hook files. Endless rule-stacking is itself the failure mode -- each detector firing produces another rule edit, each rule edit creates new firings, the cycle accumulates ceremony without resolving the underlying issue. STOP editing detectors. The fix for a noisy detector firing is rarely another rule; usually the right move is discretion (let the imperfect rule fire, continue the actual work). If a real detector bug exists, fix THAT specific bug and stop -- do not also tighten three neighboring detectors in the same turn. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  CLAIM_WITHOUT_EVIDENCE:
    "VERIFICATION DOCTRINE (Iron Law): Final text claimed completion (`tests pass`, `lands`, `live at`, `now works`, `verified`, etc.) WITHOUT a same-turn evidence-producing tool call. Claim without verification is dishonesty, not efficiency. Either (a) run the verification command NOW (Bash test/curl/build/probe, or Read of the claimed-modified file) and re-emit the claim WITH the evidence inline, or (b) drop the claim language and state actual status (e.g. `code change made; not yet verified`). The phrase `should pass`, `probably works`, or `looks correct` is also a violation -- evidence before claims, always. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.",
  FIX_WITHOUT_INVESTIGATION:
    'SYSTEMATIC-DEBUGGING PHASE GATE: User reported a bug / broken behavior / failure, and your turn made Edit/Write/MultiEdit calls WITHOUT a prior investigation-shape tool call (Read/Grep/Glob/Bash with grep/cat/log/git-diff/i-status/curl-health/etc.). NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. The fastest path to a real fix is: reproduce the symptom, trace the causal chain, identify the failing component, THEN edit. Skipping straight to a guessed fix produces symptom-patching (the next bug surfaces in the same area within hours). Either (a) investigate now -- read the relevant logs/code/state, then propose the fix with the causal chain stated, or (b) explicitly note this was a one-line obvious fix (typo, clear stack-trace pointer) where investigation would be ceremony. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  COMMENT_BLOAT:
    'COMMENT-BLOAT VIOLATION (doc/templates/AGENTS.md): A file you edited this turn contains a 5+ line consecutive inline-comment block. Rule: "Inline comments single-line and terse. Elaboration goes in doc/." Trim the block to <=2 lines OR move the explanation into doc/. Run `python3 scripts/audit-comment-bloat.py --files <path>` to see the offending blocks. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
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
  'STOP. Re-read AGENTS.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.';

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
  return /\b(do\s+all|all\s+fully|complete\s+fully|are\s+all\s+\d+|completion\s+for\s+the\s+\d+(st|nd|rd|th)\s+time)\b/i.test(text || '');
}

function scanIncompleteCompletionClaims(text) {
  if (!text) return [];
  const stripped = text.replace(/```[\s\S]*?```/g, ' ');
  const re = /\b(partial|not\s+complete|not\s+done|remaining|still\s+needs?|todo|pending|scaffold|foundation|next\s+step|would\s+need)\b[^.!?\n]{0,120}/gi;
  const out = [];
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const s = m[0].trim().replace(/\s+/g, ' ');
    if (s) out.push(s);
    if (out.length >= 6) break;
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
    // Each user message = distinct turn; COMPL counter dedups per turnIndex
    // so identical-text repeats each get fresh budget.
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
      if (v[field] === value) firing.push({ name: reasonKey, reason: REASONS[reasonKey] });
    }
    if (firing.some((f) => f.name === 'CLAIM_WITHOUT_EVIDENCE') && sessionState.recentVerificationEvidence(5 * 60 * 1000).some((e) => (e.exit_code === 0 || e.artifact || e.excerpt))) {
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

    let transcriptPath = ctx.payload && ctx.payload.transcript_path;
    if (!transcriptPath) {
      try {
        transcriptPath = fs.readFileSync(path.join(PROJECT_ROOT, 'tmp', 'hme-transcript-path.txt'), 'utf8').trim();
      } catch(_) {}
    }
    if (!transcriptPath) return ctx.allow();
    const { text: lastUser, turnIndex } = lastRealUserPrompt(transcriptPath);
    if (!lastUser) return ctx.allow();
    ctx.shared.lastRealUserText = lastUser;
    if (isStartupGraceTurn(ctx)) return ctx.allow();

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
      if (isNothingMissedResponse(lastAssistant)) {
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
