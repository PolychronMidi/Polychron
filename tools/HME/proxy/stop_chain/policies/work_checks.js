'use strict';
/**
 * Pure-JS port of work_checks.sh -- STOP_WORK / EXHAUST_CHECK gates plus
 * the AUTO-COMPLETENESS INJECT counter. Verdicts come from the verdicts
 * file; the enforcement reminder still goes to stderr; the inject counter
 * lives in tmp/hme-completeness-injected.json (50-entry cap, FIFO eviction).
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
const { PROJECT_ROOT } = require('../../shared');

const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-stop-detector-verdicts.env');
const COMPL_FILE = path.join(PROJECT_ROOT, 'tmp', 'hme-completeness-injected.json');
const COMPL_MAX = 2;

const REASONS = {
  STOP_WORK_DISMISSIVE:
    'STOP-WORK ANTIPATTERN: You responded with dismissive text instead of doing work. Re-read the user prompt and the conversation. There is always pending work after a user message -- find it and do it. If genuinely nothing remains, explain what was completed and why. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  STOP_WORK_TEXT_ONLY:
    'STOP-WORK ANTIPATTERN: Your last turn was a short text-only response with no tool calls. If there is remaining work, continue it now. If you genuinely completed everything, provide a substantive summary of what was done. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  EXHAUST:
    'EXHAUST PROTOCOL VIOLATION: Final text enumerated remaining items (TBD/noted/remaining tools) without fixing them. Every enumerated item must be fixed in the same turn. Resume and implement the highest-leverage items now. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SCOPE_ESCAPE:
    'SCOPE-ESCAPE VIOLATION: Final text dismissed a problem by labeling it pre-existing / unrelated / not-introduced-here / out-of-scope-of-this-turn instead of fixing it. The rule is: if you saw it, fix it. "Pre-existing" is not a permission slip to skip work. Either (a) fix the problem in this turn, or (b) if fixing is genuinely wrong (e.g. would break an unrelated boundary), say so explicitly and explain why fixing is the wrong move -- do NOT just label-and-stop. The rescue clause "and I fixed it" / "now resolved" suppresses this gate, so the path forward is always to fix. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHANTOM_CAPABILITY:
    'PHANTOM CAPABILITY: Your closing summary declared a thinking/delegation capability that is NOT in the closed enumeration at tools/HME/scripts/detectors/_capability_enum.py. Inventing generic labels ("decomposition", "tradeoff analysis", "deep reasoning") is a CRITICAL FAILURE -- it does NOT contribute to the tier floor. Either (a) replace the declaration with a verbatim name from the enumeration, (b) anchor the declaration with verification evidence (`(verified)`, code-quoted output, tool-call trace) within 240 chars after the name, or (c) drop the declaration. New capabilities are added by editing _capability_enum.py and bumping ENUMERATION_VERSION -- never by ad-hoc invention at run time. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHANTOM_PARAPHRASE:
    'PHANTOM PARAPHRASE (soft): Your text contained a paraphrase of a real capability (e.g. "first-principles decomposition" instead of "FirstPrinciples"). This is the shape of an agent reaching for an enumeration name without committing. Rewrite using the verbatim name from _capability_enum.py, OR drop the language if you did not actually invoke that capability. Soft flag -- does not block, but the meta-detector tracks the rate. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_MISSING_PRE_BUILD:
    'ADVISOR DOCTRINE (Rule 2 -- pre-BUILD): Tier >= E2 work just hit a BUILD/commit boundary without an advisor consult (`i/consult`). Either (a) call i/consult now with the proposed approach, (b) explicitly note "solo was right" in text with reasoning (mechanical rename, no decision to crystallize, etc.), or (c) escalate the tier -- if no advisor is needed this should not be E2+. Doctrine reference: PAI v6.3.0 Verification Doctrine Rule 2. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_MISSING_POST_DELIVER:
    'ADVISOR DOCTRINE (Rule 2 -- post-deliverable): A durable deliverable just landed and you are about to set phase: complete without a final advisor consult. Call i/consult once on the finished work asking "any gaps before declaring done?" -- OR explicitly mark the rationale for skipping. Doctrine reference: PAI v6.3.0 Verification Doctrine Rule 2 step 3. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_SILENTLY_SKIPPED:
    'ADVISOR DOCTRINE (E4/E5 floor): Tier >= E4 work completed with zero `i/consult` invocations and no solo-rationale clause. At Deep/Comprehensive effort, the advisor must fire at least once OR the agent must explicitly justify why solo was right. Re-evaluate tier or add the consult. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  ADVISOR_CONFLICT_CAP:
    'ADVISOR DOCTRINE (Rule 3 -- conflict cap): The advisor was re-called more than 2 times on the same conflict_id (see tmp/hme-advisor-conflicts.jsonl). Hard cap exceeded. Escalate to the user instead of re-calling -- keep the loop bounded. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SUMMARY_MISSING:
    'STOP-THE-LINE FORMAT VIOLATION: Tier E5 (Comprehensive) work closed without the required === SUMMARY === block. Append the closing block before stopping. Required fields: [ITERATION], [CONTENT], [STORY] (4 bullets: problem | what we did | how it went | what\'s next), and [VOICE] <name>: <8-16 word summary>. Either (a) emit the block now, or (b) re-classify the tier -- if no summary is needed, this work was lighter than E5 and the classifier should reflect that. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  SUMMARY_MALFORMED:
    'STOP-THE-LINE FORMAT VIOLATION: Closing summary block is present but missing required fields. Every E5 turn must include all 7 elements: === SUMMARY === banner, [ITERATION]:, [CONTENT]:, [STORY]: with all 4 bullets (problem, what we did, how it went, what\'s next), and [VOICE] <name>: <8-16 word closing line>. Re-emit the block with every field populated. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  LIVE_PROBE_MISSING:
    'LIVE-PROBE VIOLATION (PAI Verification Doctrine Rule 1): An ISA you edited this turn now has [x] criteria without corresponding entries in the Verification section. Every ISC marked done MUST carry tool-probe evidence (command output, Read content, screenshot) in the same ISA\'s Verification block. Either (a) add the Verification entry now -- one row per [x] ISC with the probe evidence -- or (b) revert the [x] back to [ ] / [DEFERRED-VERIFY:<task>] until the probe runs. The audit at tools/HME/scripts/isa/audit-isa.py reports the specific unverified ISC ids. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PHASE_SKIPPED:
    'PHASE GATE VIOLATION: Tier >= E3 (Algorithm) work made Edit/Write/MultiEdit calls this turn without declaring a BUILD or EXECUTE phase first. The 7-phase loop (OBSERVE -> THINK -> PLAN -> BUILD -> EXECUTE -> VERIFY -> LEARN) requires explicit transition markers so the design intent is articulated before code lands. Either (a) emit "=== BUILD ===" or "phase: build" in your text before the next edit, or (b) re-classify the tier -- if no PLAN ceremony is needed, this work was lighter than E3. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  MINIMAL_FORMAT_VIOLATION:
    'MINIMAL MODE FORMAT VIOLATION: The classifier detected a MINIMAL-mode prompt (one-line acknowledgment expected) but your response was long-form OR carried an ALGORITHM-style === SUMMARY === block. Match the mode: terse one-liner, no boilerplate. If the work was actually substantive (warranting NATIVE/ALGORITHM), ask the classifier to re-evaluate or escalate the tier explicitly. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  PILE_ON:
    'PILE-ON ANTIPATTERN: This turn edited 2+ detector / policy / hook files. Endless rule-stacking is itself the failure mode -- each detector firing produces another rule edit, each rule edit creates new firings, the cycle accumulates ceremony without resolving the underlying issue. STOP editing detectors. The fix for a noisy detector firing is rarely another rule; usually the right move is discretion (let the imperfect rule fire, continue the actual work). If a real detector bug exists, fix THAT specific bug and stop -- do not also tighten three neighboring detectors in the same turn. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  CLAIM_WITHOUT_EVIDENCE:
    "VERIFICATION DOCTRINE (Iron Law): Final text claimed completion (`tests pass`, `lands`, `live at`, `now works`, `verified`, etc.) WITHOUT a same-turn evidence-producing tool call. Claim without verification is dishonesty, not efficiency. Either (a) run the verification command NOW (Bash test/curl/build/probe, or Read of the claimed-modified file) and re-emit the claim WITH the evidence inline, or (b) drop the claim language and state actual status (e.g. `code change made; not yet verified`). The phrase `should pass`, `probably works`, or `looks correct` is also a violation -- evidence before claims, always. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.",
  FIX_WITHOUT_INVESTIGATION:
    'SYSTEMATIC-DEBUGGING PHASE GATE: User reported a bug / broken behavior / failure, and your turn made Edit/Write/MultiEdit calls WITHOUT a prior investigation-shape tool call (Read/Grep/Glob/Bash with grep/cat/log/git-diff/i-status/curl-health/etc.). NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST. The fastest path to a real fix is: reproduce the symptom, trace the causal chain, identify the failing component, THEN edit. Skipping straight to a guessed fix produces symptom-patching (the next bug surfaces in the same area within hours). Either (a) investigate now -- read the relevant logs/code/state, then propose the fix with the causal chain stated, or (b) explicitly note this was a one-line obvious fix (typo, clear stack-trace pointer) where investigation would be ceremony. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  COMMENT_BLOAT:
    'COMMENT-BLOAT VIOLATION (CLAUDE.md): A file you edited this turn contains a 5+ line consecutive inline-comment block. Rule: "Inline comments single-line and terse. Elaboration goes in doc/." Trim the block to <=2 lines OR move the explanation into doc/. Run `python3 scripts/audit-comment-bloat.py --files <path>` to see the offending blocks. If the work is actually done and there is nothing left, silence is the correct response -- do NOT write ceremony text to dodge this gate.',
  COMPL_ROUND_1:
    "AUTO-COMPLETENESS CHECK (round 1/2): If anything substantive is still unfinished from THIS TURN's work, finish it. If the work is actually complete, the correct response is silence -- end the turn. Do NOT write ceremony text, enumerated 'nothing missed' summaries, or rescue clauses just to satisfy this gate. Imperfect rules are OK; ceremony to dodge them is not.",
  COMPL_ROUND_2:
    "AUTO-COMPLETENESS CHECK (round 2/2 -- safety net): Last pass. If genuine substantive work remains, do it. Otherwise the correct response is silence -- end the turn. No 'Nothing missed' boilerplate required.",
};

const ENFORCEMENT_REMINDER =
  'STOP. Re-read CLAUDE.md and the user prompt. Did you do ALL the work asked? Every change must be implemented in code, including errors that surface along the way in other involved tools or code (in /src, /tools, or wherever the request is scoped), not just documented. If you skipped anything, go back and do it now.';

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

function readVerdicts() {
  const out = {
    STOP_WORK: 'ok',
    EXHAUST_CHECK: 'ok',
    SCOPE_ESCAPE: 'ok',
    PHANTOM_CAPABILITY: 'ok',
    ADVISOR_DOCTRINE: 'ok',
    SUMMARY_FORMAT: 'ok',
    LIVE_PROBE: 'ok',
    PHASE_GATE: 'ok',
    PILE_ON: 'ok',
    CLAIM_WITHOUT_EVIDENCE: 'ok',
    FIX_WITHOUT_INVESTIGATION: 'ok',
    COMMENT_BLOAT: 'ok',
  };
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
  // Read the most recent assistant turn's text content from the
  // transcript JSONL. Used by the round-2 skip check below -- when the
  // agent's response to round 1 was already a clean "nothing missed"
  // declaration, round 2 is pure context burn and should NOT fire.
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

// Match the "nothing missed" / "confirmed nothing remains" no-op response
// shape exactly. Conservative: only short responses that EQUAL one of these
// declarations qualify. A long answer that happens to contain "nothing
// missed" mid-sentence does NOT match -- those legitimately preceded real
// work and round 2 should still fire.
function isNothingMissedResponse(text) {
  if (!text) return false;
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length > 80) return false;  // long responses always run round 2
  const re = /^(nothing\s+missed|confirmed\s+nothing\s+(missed|remains|left)|nothing\s+remains|all\s+(set|done|clear))[.!]?$/i;
  return re.test(trimmed);
}

// Speculation-debt scanner. Surfaces phrases in the agent's last text
// that are SHAPED like unverified opinion ("I worry that...", "this might
// be...", "could be a problem", "worth investigating separately") so
// round 1's inject can name them specifically and demand each resolve
// to evidence-or-drop within the same turn.
//
// Strict false-positive control: matches only the leading speculation
// phrase + ~80 chars after, and dedup by phrase-prefix so repeated
// patterns surface once. Skip code-fenced / quoted spans (same
// discipline stop_work / exhaust_check use).
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
    // Substantive denies carry their own actionable message. The
    // generic ENFORCEMENT_REMINDER on top of those is noise -- the
    // "8x STOP. Re-read CLAUDE.md" pattern visible in test runs
    // before this gate. Emit the reminder ONLY when no specific
    // deny will fire below, so the agent gets a single coherent
    // signal per Stop event instead of (deny + boilerplate).
    // Mirrors FIRING_RULES below. ADVISOR_SILENTLY_SKIPPED and
    // CLAIM_WITHOUT_EVIDENCE are intentionally absent here -- they no
    // longer cause a deny, so they no longer suppress the reminder.
    const willDeny =
      v.STOP_WORK === 'DISMISSIVE' ||
      v.STOP_WORK === 'TEXT_ONLY_SHORT' ||
      v.EXHAUST_CHECK === 'exhaust_violation' ||
      v.SCOPE_ESCAPE === 'scope_escape_violation' ||
      v.PHANTOM_CAPABILITY === 'phantom_capability' ||
      v.PHANTOM_CAPABILITY === 'phantom_paraphrase' ||
      v.ADVISOR_DOCTRINE === 'advisor_missing_pre_build' ||
      v.ADVISOR_DOCTRINE === 'advisor_missing_post_deliver' ||
      v.ADVISOR_DOCTRINE === 'advisor_conflict_cap_exceeded' ||
      v.SUMMARY_FORMAT === 'summary_missing' ||
      v.SUMMARY_FORMAT === 'summary_malformed' ||
      v.SUMMARY_FORMAT === 'minimal_format_violation' ||
      v.LIVE_PROBE === 'live_probe_missing' ||
      v.PHASE_GATE === 'phase_skipped' ||
      v.PILE_ON === 'pile_on' ||
      v.FIX_WITHOUT_INVESTIGATION === 'fix_without_investigation' ||
      v.COMMENT_BLOAT === 'comment_bloat';
    if (!willDeny) {
      process.stderr.write(ENFORCEMENT_REMINDER + '\n');
    }

    // Aggregate ALL firing detectors into one composite deny -- agent
    // sees every flag in one pass instead of N round-trips. Order in
    // the firing list matches the historical first-deny-wins order so
    // the most-important flag heads the report.
    //
    // SOFTENED 2026-05-03: ADVISOR_SILENTLY_SKIPPED and CLAIM_WITHOUT_EVIDENCE
    // removed from FIRING_RULES. They were the load-bearing cause of the
    // "Thought for 0s" blank-response loop -- a Stop hook decision:block on
    // these eats the entire assistant turn from VSCode's UI render even
    // though the text was on disk. They remain detected (metrics still
    // accumulate via verdicts.env) but no longer trigger ctx.deny().
    // The ENFORCEMENT_REMINDER willDeny check above is left intact -- if
    // ONLY these two fire, willDeny is true, reminder is suppressed; agent
    // gets no extra signal. That's intentional: the prior signal was
    // catastrophic (turn-eating), better to silently track than to block.
    const FIRING_RULES = [
      ['STOP_WORK',          'DISMISSIVE',                 'STOP_WORK_DISMISSIVE'],
      ['STOP_WORK',          'TEXT_ONLY_SHORT',            'STOP_WORK_TEXT_ONLY'],
      ['EXHAUST_CHECK',      'exhaust_violation',          'EXHAUST'],
      ['SCOPE_ESCAPE',       'scope_escape_violation',     'SCOPE_ESCAPE'],
      ['PHANTOM_CAPABILITY', 'phantom_capability',         'PHANTOM_CAPABILITY'],
      ['PHANTOM_CAPABILITY', 'phantom_paraphrase',         'PHANTOM_PARAPHRASE'],
      ['ADVISOR_DOCTRINE',   'advisor_missing_pre_build',  'ADVISOR_MISSING_PRE_BUILD'],
      ['ADVISOR_DOCTRINE',   'advisor_missing_post_deliver','ADVISOR_MISSING_POST_DELIVER'],
      // ['ADVISOR_DOCTRINE','advisor_silently_skipped',   'ADVISOR_SILENTLY_SKIPPED'],  // softened: detected, not denied
      ['ADVISOR_DOCTRINE',   'advisor_conflict_cap_exceeded','ADVISOR_CONFLICT_CAP'],
      ['SUMMARY_FORMAT',     'summary_missing',            'SUMMARY_MISSING'],
      ['SUMMARY_FORMAT',     'summary_malformed',          'SUMMARY_MALFORMED'],
      ['SUMMARY_FORMAT',     'minimal_format_violation',   'MINIMAL_FORMAT_VIOLATION'],
      ['LIVE_PROBE',         'live_probe_missing',         'LIVE_PROBE_MISSING'],
      ['PHASE_GATE',         'phase_skipped',              'PHASE_SKIPPED'],
      ['PILE_ON',            'pile_on',                    'PILE_ON'],
      // ['CLAIM_WITHOUT_EVIDENCE','claim_without_evidence','CLAIM_WITHOUT_EVIDENCE'],   // softened: detected, not denied
      ['FIX_WITHOUT_INVESTIGATION',  'fix_without_investigation',  'FIX_WITHOUT_INVESTIGATION'],
      ['COMMENT_BLOAT',              'comment_bloat',              'COMMENT_BLOAT'],
    ];
    const firing = [];
    for (const [field, value, reasonKey] of FIRING_RULES) {
      if (v[field] === value) firing.push({ name: reasonKey, reason: REASONS[reasonKey] });
    }
    if (firing.length === 1) {
      return ctx.deny(firing[0].reason);
    }
    if (firing.length > 1) {
      const header = `MULTI-FLAG STOP (${firing.length} detectors firing): ${firing.map((f) => f.name).join(', ')}.\nAddress all of them in this turn.\n\n`;
      const body = firing.map((f, i) => `--- [${i + 1}/${firing.length}] ${f.name} ---\n${f.reason}`).join('\n\n');
      return ctx.deny(header + body);
    }

    // Auto-completeness inject -- fires up to COMPL_MAX times per user-turn.
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
    // Round-2 skip: if the assistant's response to round 1 was a clean
    // "nothing missed" / "confirmed nothing remains" no-op, round 2 is
    // pure context burn -- it provokes another no-op response and adds
    // zero value. Advance the counter to MAX (spending the budget) and
    // return allow without firing the deny. Round 1 still fires
    // unconditionally as the safety check; only the redundant round 2
    // is suppressed when round 1 was definitively answered.
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
      // Round 1: targeted speculation-debt scan. If the agent's last
      // text contains unverified-opinion phrases ("I worry", "might
      // be", "worth investigating", etc.), name them specifically in
      // the inject so the agent must resolve each to evidence or drop
      // it. Without this, speculation accumulates across turns into
      // permanent fog. Compresses the speculation->evidence distance
      // by making the prompt actionable instead of generic.
      const lastAssistant = lastAssistantText(transcriptPath);
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
        return ctx.deny(targeted);
      }
      return ctx.deny(REASONS.COMPL_ROUND_1);
    }
    return ctx.deny(REASONS.COMPL_ROUND_2);
  },
};
