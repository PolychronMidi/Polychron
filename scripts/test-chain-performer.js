#!/usr/bin/env node
// End-to-end-ish test for ChainPerformer:
//   1. Gate logic: hasMeterLiveUpdate + pctUsed < threshold + inProgress
//   2. Threshold crossing: 84% does NOT fire, 85% DOES
//   3. Out-of-range pct is refused (fail-fast guard)
//   4. Summary prompt is actually built (not stubbed out) when the chain fires
//
// The LLM call itself (synthesizeChainSummary) is stubbed — we're testing
// every layer of ChainPerformer *except* the network hop. A real local model
// would make this flaky across environments; stubbing keeps it deterministic
// while still exercising the rotation plumbing.
//
// Usage: node scripts/test-chain-performer.js

const path = require("path");
const Module = require("module");

// Stub Arbiter.synthesizeChainSummary BEFORE ChainPerformer requires it.
// ChainPerformer resolves "../Arbiter" relative to its own out/ dir. Hook
// the module loader so that path returns our stub.
const chatOutDir = path.join(__dirname, "..", "tools", "HME", "chat", "out");
const arbiterPath = path.join(chatOutDir, "Arbiter.js");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  const resolved = origResolve.call(this, request, parent, ...rest);
  return resolved;
};
require.cache[arbiterPath] = {
  id: arbiterPath,
  filename: arbiterPath,
  loaded: true,
  exports: {
    synthesizeChainSummary: async (prompt) => {
      require.cache[arbiterPath]._lastPrompt = prompt;
      return "## State\nstubbed-summary\n";
    },
  },
};

const { ChainPerformer, CHAIN_THRESHOLD_PCT } = require(path.join(chatOutDir, "panel", "ChainPerformer.js"));

let pass = 0, fail = 0;
const failures = [];
function check(label, cond, detail) {
  if (cond) { pass++; if (process.env.VERBOSE) console.log(`PASS: ${label}`); }
  else { fail++; failures.push(`${label}${detail ? ` (${detail})` : ""}`); console.log(`FAIL: ${label}${detail ? ` (${detail})` : ""}`); }
}

// ── fixtures ───────────────────────────────────────────────────────────
function makeHost() {
  const posts = [];
  const errors = [];
  return {
    posts, errors,
    post: (msg) => posts.push(msg),
    postError: (src, m) => errors.push({ src, m }),
  };
}

function makeSession({ pct, hasUpdate = true, sessionId = "test-session" }) {
  const rotated = [];
  return {
    rotated,
    getSessionId: () => sessionId,
    getMessages: () => [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }],
    getChainIndex: () => 0,
    getClaudeSessionId: () => "claude-123",
    getContextPct: () => pct,
    hasMeterLiveUpdate: () => hasUpdate,
    rotate: (msg, idx) => rotated.push({ msg, idx }),
    postContextUpdate: () => {},
  };
}

function makeSink() {
  const rejections = [];
  return { rejections, post: (s, m) => rejections.push({ s, m }) };
}

// ── threshold constant sanity ──────────────────────────────────────────
check(`CHAIN_THRESHOLD_PCT is 85 (was 99 — see ChainPerformer.ts:11)`, CHAIN_THRESHOLD_PCT === 85,
  `got ${CHAIN_THRESHOLD_PCT}`);

// ── gate 1: no live update → no fire ───────────────────────────────────
{
  const host = makeHost();
  const session = makeSession({ pct: 95, hasUpdate: false });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();
  check("no live update → maybeChain does not fire", session.rotated.length === 0);
  check("no live update → no error posted", host.errors.length === 0 && sink.rejections.length === 0);
}

// ── gate 2: pct below threshold → no fire ──────────────────────────────
{
  const host = makeHost();
  const session = makeSession({ pct: 84 });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();
  check("pct=84 (< threshold 85) → no fire", session.rotated.length === 0);
}

// ── gate 3: out-of-range pct → refused (fail-fast) ─────────────────────
{
  const host = makeHost();
  const session = makeSession({ pct: 150 });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();
  check("pct=150 → maybeChain does not rotate", session.rotated.length === 0);
  check("pct=150 → errorSink received rejection",
    sink.rejections.some(r => /out-of-range|maybeChain/.test(r.m)),
    `rejections: ${JSON.stringify(sink.rejections)}`);
  check("pct=150 → host.postError emitted",
    host.errors.some(e => /invalid context pct/.test(e.m)));
}

{
  const host = makeHost();
  const session = makeSession({ pct: -1 });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();
  check("pct=-1 → maybeChain does not rotate", session.rotated.length === 0);
  check("pct=-1 → errorSink received rejection", sink.rejections.length === 1);
}

{
  const host = makeHost();
  const session = makeSession({ pct: NaN });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();
  check("pct=NaN → maybeChain does not rotate", session.rotated.length === 0);
  check("pct=NaN → errorSink received rejection", sink.rejections.length === 1);
}

// ── fire: pct >= threshold → full chain executes async ─────────────────
async function runFireTest() {
  const host = makeHost();
  const session = makeSession({ pct: 85 });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  perf.maybeChain();

  // _performChain is async — wait briefly for the promise chain to settle.
  await new Promise(r => setTimeout(r, 100));

  check("pct=85 (>= threshold) → rotation happened", session.rotated.length === 1,
    `rotated=${session.rotated.length}, inProgress=${perf.inProgress}, errors=${JSON.stringify(host.errors)}`);
  if (session.rotated.length === 1) {
    const { msg, idx } = session.rotated[0];
    check("rotation advances chainIndex by 1", idx === 1);
    check("rotation continuation message has role=user", msg.role === "user");
    check("rotation continuation message references link index",
      /Context Chain — Link 1/.test(msg.text));
    check("rotation continuation includes the (stubbed) summary",
      /stubbed-summary/.test(msg.text));
  }
  check("host.post received chainCompleted",
    host.posts.some(p => p.type === "chainCompleted"));
  check("host.post received notice",
    host.posts.some(p => p.type === "notice"));

  // The prompt builder was actually called with real messages.
  const lastPrompt = require.cache[arbiterPath]._lastPrompt;
  check("summary prompt was built and passed to synthesizer",
    typeof lastPrompt === "string" && lastPrompt.length > 100,
    `got len=${lastPrompt ? lastPrompt.length : 0}`);
  check("summary prompt contains session messages",
    typeof lastPrompt === "string" && /hi|hello/.test(lastPrompt));
}

// ── fire suppressed when already in progress ───────────────────────────
async function runConcurrentFireTest() {
  const host = makeHost();
  const session = makeSession({ pct: 95 });
  const sink = makeSink();
  const perf = new ChainPerformer("/tmp/test-root", host, session, sink);
  // Fire once → starts async work.
  perf.maybeChain();
  // Immediately fire again → should be suppressed by _inProgress.
  perf.maybeChain();
  // Fire a third time for good measure.
  perf.maybeChain();
  await new Promise(r => setTimeout(r, 100));
  check("concurrent maybeChain calls result in exactly 1 rotation",
    session.rotated.length === 1, `got ${session.rotated.length}`);
}

(async () => {
  await runFireTest();
  await runConcurrentFireTest();
  console.log(`\nPassed: ${pass}   Failed: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  process.exit(0);
})();
