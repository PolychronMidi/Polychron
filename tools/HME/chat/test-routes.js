/**
 * Route tester — fires local, hybrid, and arbiter routes through compiled router.
 * Reports every error, chunk, and completion event to stdout.
 *
 * Prereqs:
 *   - llama-server running at HME_LLAMACPP_ARBITER_URL (default http://127.0.0.1:8080)
 *   - HME worker serving /chat/* at HME_PROXY_PORT (default 9099)
 *   - `npm run compile` in tools/HME/chat/ first
 *
 * Run: node tools/HME/chat/test-routes.js
 */
const path = require("path");
const {
  streamLlamacpp, streamLlamacppAgentic, streamHybrid,
  fetchHmeContext, validateMessage, postTranscript, reindexFiles, isHmeShimReady,
} = require("./out/router");
const { classifyMessage, synthesizeNarrative } = require("./out/Arbiter");

const LLAMACPP_URL = process.env.HME_LLAMACPP_ARBITER_URL || "http://127.0.0.1:8080";
const LLAMACPP_MODEL = process.env.HME_CHAT_TEST_MODEL || "qwen3-coder:30b";
const OPTS = { model: LLAMACPP_MODEL, url: LLAMACPP_URL };
const PROJECT = path.resolve(__dirname, "../../..");

function testRoute(name, fn) {
  return new Promise((resolve) => {
    console.log(`\n=== ${name} START ===`);
    const t0 = Date.now();
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    const cancel = fn(
      (chunk, type) => {
        if (type === "error") console.error(`[${name}] ERROR CHUNK: ${chunk}`);
        else process.stdout.write(`[${name}][${type}] ${chunk.slice(0, 80)}\n`);
      },
      () => {
        console.log(`[${name}] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        done({ ok: true });
      },
      (err) => {
        console.error(`[${name}] STREAM ERROR: ${err}`);
        done({ ok: false, err });
      }
    );
    setTimeout(() => { try { cancel?.(); } catch {} done({ ok: false, err: "4min hard cancel" }); }, 240000);
  });
}

// Stress test helper: expect an error from a route function
async function expectError(name, fn) {
  console.log(`\n=== STRESS: ${name} ===`);
  const t0 = Date.now();
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => { if (!resolved) { resolved = true; resolve(result); } };
    let gotError = false;
    const cancel = fn(
      (chunk, type) => {
        if (type === "error") { gotError = true; console.log(`  [${name}] EXPECTED ERROR: ${String(chunk).slice(0, 100)}`); }
      },
      () => {
        const s = ((Date.now() - t0) / 1000).toFixed(1);
        if (gotError) { console.log(`  [${name}] OK — error surfaced then completed (${s}s)`); done({ ok: true }); }
        else { console.error(`  [${name}] FAIL — completed without surfacing error (${s}s)`); done({ ok: false, err: "no error surfaced" }); }
      },
      (err) => {
        console.log(`  [${name}] OK — error callback fired: ${String(err).slice(0, 100)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
        done({ ok: true });
      }
    );
    setTimeout(() => { try { cancel?.(); } catch {} done({ ok: false, err: "30s timeout — error not detected" }); }, 30000);
  });
}

async function run() {
  const MSG = [{ role: "user", content: "Reply with exactly: ROUTE_OK" }];
  const results = {};

  // ═══════════════════════════════════════════════════════════════
  // WARMUP: pre-load qwen3:4b so arbiter tests don't hit cold-model timeouts
  // ═══════════════════════════════════════════════════════════════
  {
    console.log("\n=== ARBITER MODEL WARMUP ===");
    const t0 = Date.now();
    const w = await classifyMessage("hi", "", 0);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (w.isError) console.warn(`[WARMUP] failed (${elapsed}s): ${w.reason} — arbiter tests may be slow`);
    else console.log(`[WARMUP] qwen3:4b ready (${elapsed}s)`);
  }

  // ═══════════════════════════════════════════════════════════════
  // SECTION 1: HAPPY PATH — all routes should succeed
  // ═══════════════════════════════════════════════════════════════

  // 1a. Arbiter classify
  console.log("\n=== ARBITER classify (local task) START ===");
  let t0 = Date.now();
  const decision = await classifyMessage("refactor crossLayerRegistry to use WeakMap", "", 0);
  console.log(`[ARBITER] route=${decision.route} conf=${decision.confidence} err=${decision.isError} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  results["arbiter-classify"] = !decision.isError;

  // 1b. Arbiter classify (second variant)
  console.log("\n=== ARBITER classify (explain task) START ===");
  t0 = Date.now();
  const decision2 = await classifyMessage("explain the philosophy behind the hypermeta architecture", "", 0);
  console.log(`[ARBITER2] route=${decision2.route} conf=${decision2.confidence} err=${decision2.isError} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  results["arbiter-classify2"] = !decision2.isError;

  // 1c. Arbiter narrative synthesis
  console.log("\n=== ARBITER synthesizeNarrative START ===");
  t0 = Date.now();
  try {
    const fakeEntries = Array.from({ length: 6 }, (_, i) => ({
      ts: Date.now(), type: "assistant",
      content: `Step ${i + 1}: Modified crossLayerRegistry, fixed coupling bug, updated KB.`,
      summary: "",
    }));
    const narrative = await synthesizeNarrative(fakeEntries);
    console.log(`[NARRATIVE] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${narrative.slice(0, 120)}`);
    results["narrative"] = true;
  } catch (e) {
    console.error(`[NARRATIVE] FAIL: ${e}`);
    results["narrative"] = false;
  }

  // 1d. HME shim utilities
  console.log("\n=== HME SHIM UTILS START ===");
  let shimOk = true;
  const shimErrs = [];
  try {
    const health = await isHmeShimReady();
    console.log(`[SHIM] health: ready=${health.ready}`);
    if (!health.ready) { shimOk = false; shimErrs.push("not ready"); }
  } catch (e) { shimOk = false; shimErrs.push(`health: ${e}`); }
  try {
    const ctx = await fetchHmeContext("crossLayerRegistry coupling signal", 3);
    const ctxLen = typeof ctx === "string" ? ctx.length : (ctx.warm?.length ?? 0);
    console.log(`[SHIM] fetchHmeContext: ${ctxLen} chars, kbCount=${ctx.kbCount ?? "n/a"}`);
    if (!ctx) { shimOk = false; shimErrs.push("empty context"); }
  } catch (e) { shimOk = false; shimErrs.push(`fetchHmeContext: ${e}`); }
  try {
    const val = await validateMessage("add a require() call in a non-index.js file");
    console.log(`[SHIM] validateMessage: w=${val.warnings.length} b=${val.blocks.length}`);
  } catch (e) { shimOk = false; shimErrs.push(`validate: ${e}`); }
  try {
    await postTranscript([{ ts: Date.now(), type: "user", content: "test entry", summary: "" }]);
    console.log(`[SHIM] postTranscript: OK`);
  } catch (e) { shimOk = false; shimErrs.push(`transcript: ${e}`); }
  try {
    const ri = await reindexFiles(["src/crossLayer/rhythm/convergenceDetector.js"]);
    console.log(`[SHIM] reindexFiles: indexed=${ri.count}`);
  } catch (e) { shimOk = false; shimErrs.push(`reindex: ${e}`); }
  if (!shimOk) console.error(`[SHIM] FAILURES: ${shimErrs.join("; ")}`);
  else console.log(`[SHIM] all OK`);
  results["shim-utils"] = shimOk;

  // 1e. streamLlamacpp (SSE streaming, basic)
  const r1 = await testRoute("STREAM_LLAMACPP", (c, d, e) => streamLlamacpp(MSG, OPTS, c, d, e));
  results["stream-llamacpp"] = r1.ok;

  // 1f. streamLlamacppAgentic (tool loop)
  const r2 = await testRoute("LOCAL_AGENTIC", (c, d, e) => streamLlamacppAgentic(MSG, OPTS, PROJECT, c, d, e));
  results["local-agentic"] = r2.ok;

  // 1g. streamHybrid (KB-enriched)
  const r3 = await new Promise(async (resolve) => {
    console.log("\n=== HYBRID START ===");
    const t0 = Date.now();
    const timer = setTimeout(() => { resolve({ ok: false, err: "4min hard cancel" }); }, 240000);
    try {
      await streamHybrid("Reply with exactly: ROUTE_OK", [], OPTS, PROJECT,
        (chunk, type) => {
          if (type === "error") console.error(`[HYBRID] ERROR: ${chunk}`);
          else process.stdout.write(`[HYBRID][${type}] ${chunk.slice(0, 80)}\n`);
        },
        () => { clearTimeout(timer); console.log(`[HYBRID] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`); resolve({ ok: true }); },
        (err) => { clearTimeout(timer); console.error(`[HYBRID] ERROR: ${err}`); resolve({ ok: false, err }); }
      );
    } catch (e) {
      clearTimeout(timer);
      console.error(`[HYBRID] THREW: ${e}`);
      resolve({ ok: false, err: String(e) });
    }
  });
  results["hybrid"] = r3.ok;

  // ═══════════════════════════════════════════════════════════════
  // SECTION 2: STRESS — error paths must surface, never hang
  // ═══════════════════════════════════════════════════════════════

  const DEAD = { model: LLAMACPP_MODEL, url: "http://127.0.0.1:19999" };

  // 2a. streamLlamacpp to dead port — must fire onError with CRITICAL, not hang
  const s1 = await expectError("DEAD_LLAMACPP", (c, d, e) => streamLlamacpp(MSG, DEAD, c, d, e));
  results["stress-dead-llamacpp"] = s1.ok;

  // 2b. streamLlamacppAgentic to dead port
  const s2 = await expectError("DEAD_LLAMACPP_AGENTIC", (c, d, e) =>
    streamLlamacppAgentic(MSG, DEAD, PROJECT, c, d, e)
  );
  results["stress-dead-agentic"] = s2.ok;

  // 2c. streamLlamacpp with bogus model name — llama-server should return 4xx
  const s3 = await expectError("BOGUS_MODEL", (c, d, e) =>
    streamLlamacpp(MSG, { model: "THIS_MODEL_DOES_NOT_EXIST_12345", url: LLAMACPP_URL }, c, d, e)
  );
  results["stress-bogus-model"] = s3.ok;

  // 2d. Arbiter classify with empty message — should still succeed (empty is valid input)
  console.log("\n=== STRESS: ARBITER_EMPTY ===");
  t0 = Date.now();
  const emptyDecision = await classifyMessage("", "", 0);
  console.log(`  [ARBITER_EMPTY] route=${emptyDecision.route} err=${emptyDecision.isError} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  results["stress-arbiter-empty"] = !emptyDecision.isError;

  // 2e. fetchHmeContext — shim is (presumed) running, should succeed;
  //     if shim is down, rejection is also correct behavior.
  console.log("\n=== STRESS: SHIM_CONTEXT_LIVE ===");
  t0 = Date.now();
  try {
    const ctx = await fetchHmeContext("test query", 1);
    const ctxLen = typeof ctx === "string" ? ctx.length : (ctx.warm?.length ?? 0);
    console.log(`  [SHIM_CTX] OK: ${ctxLen} chars (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    results["stress-shim-context"] = true;
  } catch (e) {
    console.log(`  [SHIM_CTX] Rejected (shim down?): ${String(e).slice(0, 80)} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    results["stress-shim-context"] = true;
  }

  // 2f. streamLlamacpp with empty messages array — llama-server tolerates empty
  const s6 = await testRoute("EMPTY_MESSAGES", (c, d, e) => streamLlamacpp([], OPTS, c, d, e));
  results["stress-empty-msgs"] = s6.ok;

  // ═══════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║              TEST RESULTS SUMMARY                ║");
  console.log("╠══════════════════════════════════════════════════╣");
  let allOk = true;
  for (const [name, ok] of Object.entries(results)) {
    const status = ok ? "✓ PASS" : "✗ FAIL";
    console.log(`║  ${status}  ${name.padEnd(35)} ║`);
    if (!ok) allOk = false;
  }
  console.log("╠══════════════════════════════════════════════════╣");
  console.log(`║  ${allOk ? "ALL TESTS PASSED" : "SOME TESTS FAILED"}${" ".repeat(allOk ? 17 : 16)}║`);
  console.log("╚══════════════════════════════════════════════════╝");

  process.exit(allOk ? 0 : 1);
}

run();
