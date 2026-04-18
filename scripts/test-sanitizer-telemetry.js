#!/usr/bin/env node
// Verifier for the usedPct sanitizer's telemetry contract.
//
// Every rejection path in sanitizeUsedPct must:
//   1. Return undefined (so the meter keeps its last good value)
//   2. Call the registered ErrorSink with a non-empty message
//
// Without this verifier, a future refactor can silently drop either
// half — returning undefined but never reporting, or logging but
// returning the bad value. The original 1M-vs-200k bug was exactly
// "logged" (nowhere) + "returned" (to the meter, which trusted it).
//
// Usage: node scripts/test-sanitizer-telemetry.js
// Exit 0 on all-pass, 1 on any failure with the offending case.

const path = require("path");

// Require the compiled router module directly. Smoke harness, not Jest.
const routerPath = path.join(__dirname, "..", "tools", "HME", "chat", "out", "routers", "routerClaude.js");
let router;
try {
  router = require(routerPath);
} catch (e) {
  console.error(`FAIL: cannot require ${routerPath}: ${e.message}`);
  console.error("Run `cd tools/HME/chat && npm run compile` first.");
  process.exit(1);
}

const { sanitizeUsedPct, setSanitizerErrorSink, setTurnNumberProvider,
        USED_PCT_HARD_CEILING, USED_PCT_SUSPICIOUS_FLOOR } = router;

// Collect rejections in memory.
const captured = [];
setSanitizerErrorSink({
  post: (source, message) => captured.push({ source, message }),
});

let pass = 0, fail = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    pass++;
    if (process.env.VERBOSE) console.log(`PASS: ${label}`);
  } else {
    fail++;
    failures.push(`${label}${detail ? ` (${detail})` : ""}`);
    console.log(`FAIL: ${label}${detail ? ` (${detail})` : ""}`);
  }
}

function reset() { captured.length = 0; }
function lastMessage() { return captured.length ? captured[captured.length - 1].message : null; }

// ── null/undefined: must return undefined, must NOT report ─────────────
reset();
check("null returns undefined", sanitizeUsedPct(null, "test") === undefined);
check("null does NOT emit telemetry", captured.length === 0, `got ${captured.length} reports`);

reset();
check("undefined returns undefined", sanitizeUsedPct(undefined, "test") === undefined);
check("undefined does NOT emit telemetry", captured.length === 0);

// ── non-finite: must return undefined, MUST report ─────────────────────
reset();
check("NaN returns undefined", sanitizeUsedPct(NaN, "test") === undefined);
check("NaN emits telemetry", captured.length === 1 && /non-finite/.test(lastMessage() || ""));

reset();
check("Infinity returns undefined", sanitizeUsedPct(Infinity, "test") === undefined);
check("Infinity emits telemetry", captured.length === 1 && /non-finite/.test(lastMessage() || ""));

reset();
check("string returns undefined", sanitizeUsedPct("50", "test") === undefined);
check("string emits telemetry", captured.length === 1 && /non-finite/.test(lastMessage() || ""));

// ── out of hard range: return undefined + report ───────────────────────
reset();
check("-1 returns undefined", sanitizeUsedPct(-1, "test") === undefined);
check("-1 emits telemetry", captured.length === 1 && /out-of-range|hard ceiling/.test(lastMessage() || ""));

reset();
const tooHigh = USED_PCT_HARD_CEILING + 0.1;
check(`${tooHigh} returns undefined`, sanitizeUsedPct(tooHigh, "test") === undefined);
check(`${tooHigh} emits telemetry`, captured.length === 1 && /out-of-range|hard ceiling/.test(lastMessage() || ""));

reset();
check("1456 (the original bug value) returns undefined", sanitizeUsedPct(1456.5, "test") === undefined);
check("1456 emits telemetry", captured.length === 1, `expected 1 report, got ${captured.length}`);

// ── in range: return rounded number, NO report ─────────────────────────
setTurnNumberProvider(() => 10); // well past suspicious-band guard
reset();
check("50 returns 50", sanitizeUsedPct(50, "test") === 50);
check("50 does NOT emit telemetry", captured.length === 0);

reset();
check("50.47 rounds to 50.5", sanitizeUsedPct(50.47, "test") === 50.5);
check("50.47 does NOT emit telemetry", captured.length === 0);

reset();
check("0 returns 0", sanitizeUsedPct(0, "test") === 0);
check("USED_PCT_HARD_CEILING boundary", sanitizeUsedPct(USED_PCT_HARD_CEILING, "test") === USED_PCT_HARD_CEILING);

// ── suspicious band ────────────────────────────────────────────────────
// Mid-session (turn 10): suspicious band should NOT emit.
setTurnNumberProvider(() => 10);
reset();
const midSessionSuspicious = USED_PCT_SUSPICIOUS_FLOOR + 1;
check(`${midSessionSuspicious}% at turn 10 propagates`, sanitizeUsedPct(midSessionSuspicious, "test") === midSessionSuspicious);
check(`${midSessionSuspicious}% at turn 10 does NOT emit suspicious_pct`,
  !captured.some(c => /suspicious_pct/.test(c.message)),
  `captured: ${JSON.stringify(captured.map(c => c.message))}`);

// Early session (turn 1): same value should fire suspicious_pct.
setTurnNumberProvider(() => 1);
reset();
check(`${midSessionSuspicious}% at turn 1 propagates`, sanitizeUsedPct(midSessionSuspicious, "test") === midSessionSuspicious);
check(`${midSessionSuspicious}% at turn 1 emits suspicious_pct`,
  captured.some(c => /suspicious_pct/.test(c.message)),
  `captured: ${JSON.stringify(captured.map(c => c.message))}`);

// Turn 2 still suspicious.
setTurnNumberProvider(() => 2);
reset();
check(`99% at turn 2 emits suspicious_pct`,
  (sanitizeUsedPct(99, "test") === 99) && captured.some(c => /suspicious_pct/.test(c.message)));

// Turn 3: no longer suspicious.
setTurnNumberProvider(() => 3);
reset();
check(`99% at turn 3 does NOT emit suspicious_pct`,
  (sanitizeUsedPct(99, "test") === 99) && !captured.some(c => /suspicious_pct/.test(c.message)));

// Null turn provider: the suspicious-band check is skipped (can't attribute
// to early-turn). The value still propagates.
setTurnNumberProvider(() => null);
reset();
check(`99% with null turn provider propagates`, sanitizeUsedPct(99, "test") === 99);
check(`99% with null turn provider does NOT emit suspicious_pct`,
  !captured.some(c => /suspicious_pct/.test(c.message)));

// ── contract: every rejection carries the source tag ───────────────────
setTurnNumberProvider(() => 10);
reset();
sanitizeUsedPct(NaN, "my-unique-source-tag");
check("rejection message contains the source tag",
  captured.length === 1 && captured[0].message.includes("my-unique-source-tag"));

// ── summary ────────────────────────────────────────────────────────────
console.log(`\nPassed: ${pass}   Failed: ${fail}`);
if (fail > 0) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f}`));
  process.exit(1);
}
process.exit(0);
