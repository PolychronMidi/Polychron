/**
 * Route tester — fires local, hybrid, and arbiter routes through compiled router.
 * Reports every error, chunk, and completion event to stdout.
 * Run: node tools/HME/chat/test-routes.js
 */
const path = require("path");
const {
  streamOllama, streamOllamaAgentic, streamHybrid,
  fetchHmeContext, validateMessage, auditChanges,
  postTranscript, reindexFiles, postNarrative, isHmeShimReady, logShimError,
} = require("./out/router");
const { classifyMessage, synthesizeNarrative } = require("./out/Arbiter");

const OPTS = { model: "qwen3-coder:30b", url: "http://localhost:11434" };
const ARBITER_OPTS = { model: "qwen3:4b", url: "http://localhost:11434" };
const PROJECT = path.resolve(__dirname, "../../..");

function testRoute(name, fn) {
  return new Promise((resolve) => {
    console.log(`\n=== ${name} START ===`);
    const t0 = Date.now();
    const cancel = fn(
      (chunk, type) => {
        if (type === "error") console.error(`[${name}] ERROR CHUNK: ${chunk}`);
        else process.stdout.write(`[${name}][${type}] ${chunk.slice(0, 80)}\n`);
      },
      () => {
        console.log(`[${name}] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        resolve({ ok: true });
      },
      (err) => {
        console.error(`[${name}] STREAM ERROR: ${err}`);
        resolve({ ok: false, err });
      }
    );
    // Hard cancel at 4 min
    setTimeout(() => { cancel(); resolve({ ok: false, err: "4min hard cancel" }); }, 240000);
  });
}

async function run() {
  const MSG = [{ role: "user", content: "Reply with exactly: ROUTE_OK" }];

  // 1. ARBITER — classify multiple message types + synthesize narrative
  console.log("\n=== ARBITER classify (local task) START ===");
  let t0 = Date.now();
  const decision = await classifyMessage("refactor crossLayerRegistry to use WeakMap", "", 0);
  console.log(`[ARBITER] route=${decision.route} confidence=${decision.confidence} isError=${decision.isError} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`[ARBITER] reason: ${decision.reason}`);

  console.log("\n=== ARBITER classify (claude task) START ===");
  t0 = Date.now();
  const decision2 = await classifyMessage("explain the philosophy behind the hypermeta architecture and what makes it unique", "", 0);
  console.log(`[ARBITER2] route=${decision2.route} confidence=${decision2.confidence} isError=${decision2.isError} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`[ARBITER2] reason: ${decision2.reason}`);

  console.log("\n=== ARBITER synthesizeNarrative START ===");
  t0 = Date.now();
  let narrativeOk = false;
  let narrativeErr = "";
  try {
    const fakeEntries = Array.from({ length: 6 }, (_, i) => ({
      role: "assistant", content: `Step ${i + 1}: Modified crossLayerRegistry, fixed coupling bug, updated KB.`, summary: ""
    }));
    const narrative = await synthesizeNarrative(fakeEntries);
    console.log(`[NARRATIVE] OK in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${narrative.slice(0, 120)}`);
    narrativeOk = true;
  } catch (e) {
    narrativeErr = String(e);
    console.error(`[NARRATIVE] FAIL in ${((Date.now() - t0) / 1000).toFixed(1)}s: ${narrativeErr}`);
  }

  // 2. HME shim utility functions
  console.log("\n=== HME SHIM UTILS START ===");
  let shimOk = true; const shimErrs = [];
  try {
    const health = await isHmeShimReady();
    console.log(`[SHIM] health: ready=${health.ready} errors=${JSON.stringify(health.errors).slice(0,80)}`);
    if (!health.ready) { shimOk = false; shimErrs.push("shim not ready"); }
  } catch(e) { shimOk = false; shimErrs.push(`isHmeShimReady: ${e}`); }

  try {
    const ctx = await fetchHmeContext("crossLayerRegistry coupling signal", 3);
    console.log(`[SHIM] fetchHmeContext: ${ctx.length} chars`);
    if (!ctx) { shimOk = false; shimErrs.push("fetchHmeContext empty"); }
  } catch(e) { shimOk = false; shimErrs.push(`fetchHmeContext: ${e}`); }

  try {
    const val = await validateMessage("add a require() call in a non-index.js file");
    console.log(`[SHIM] validateMessage: warnings=${val.warnings.length} blocks=${val.blocks.length}`);
  } catch(e) { shimOk = false; shimErrs.push(`validateMessage: ${e}`); }

  try {
    await postTranscript([{ role: "user", content: "test entry", summary: "" }]);
    console.log(`[SHIM] postTranscript: OK`);
  } catch(e) { shimOk = false; shimErrs.push(`postTranscript: ${e}`); }

  try {
    const ri = await reindexFiles(["src/crossLayer/rhythm/convergenceDetector.js"]);
    console.log(`[SHIM] reindexFiles: indexed=${ri.count}`);
  } catch(e) { shimOk = false; shimErrs.push(`reindexFiles: ${e}`); }

  try {
    await logShimError("test-routes", "test error from test-routes.js", "deliberate test");
    console.log(`[SHIM] logShimError: OK`);
  } catch(e) { shimOk = false; shimErrs.push(`logShimError: ${e}`); }

  if (!shimOk) console.error(`[SHIM] FAILURES: ${shimErrs.join("; ")}`);
  else console.log(`[SHIM] DONE — all shim utils OK`);

  // 3. STREAM_OLLAMA — basic (non-agentic) streaming
  const streamResult = await testRoute("STREAM_OLLAMA", (onChunk, onDone, onError) =>
    streamOllama(MSG, OPTS, onChunk, onDone, onError)
  );

  // 4. LOCAL — streamOllamaAgentic (no HME context)
  const localResult = await testRoute("LOCAL", (onChunk, onDone, onError) =>
    streamOllamaAgentic(MSG, OPTS, PROJECT, onChunk, onDone, onError)
  );

  // 2. HYBRID — streamHybrid (HME enrichment + agentic)
  let hybridCancel;
  const hybridResult = await new Promise(async (resolve) => {
    console.log("\n=== HYBRID START ===");
    const t0 = Date.now();
    const timer = setTimeout(() => { hybridCancel?.(); resolve({ ok: false, err: "4min hard cancel" }); }, 240000);
    hybridCancel = await streamHybrid(
      "Reply with exactly: ROUTE_OK",
      [],
      OPTS,
      PROJECT,
      (chunk, type) => {
        if (type === "error") console.error(`[HYBRID] ERROR CHUNK: ${chunk}`);
        else process.stdout.write(`[HYBRID][${type}] ${chunk.slice(0, 80)}\n`);
      },
      () => {
        clearTimeout(timer);
        console.log(`[HYBRID] DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        resolve({ ok: true });
      },
      (err) => {
        clearTimeout(timer);
        console.error(`[HYBRID] STREAM ERROR: ${err}`);
        resolve({ ok: false, err });
      }
    );
  });

  console.log("\n=== SUMMARY ===");
  console.log(`ARBITER classify(local):  ${decision.isError ? "FAIL: " + decision.reason : "OK route=" + decision.route}`);
  console.log(`ARBITER classify(claude): ${decision2.isError ? "FAIL: " + decision2.reason : "OK route=" + decision2.route}`);
  console.log(`ARBITER narrative:        ${narrativeOk ? "OK" : "FAIL: " + narrativeErr}`);
  console.log(`SHIM utils:               ${shimOk ? "OK" : "FAIL: " + shimErrs.join("; ")}`);
  console.log(`STREAM_OLLAMA:            ${streamResult.ok ? "OK" : "FAIL: " + streamResult.err}`);
  console.log(`LOCAL (agentic):          ${localResult.ok ? "OK" : "FAIL: " + localResult.err}`);
  console.log(`HYBRID:                   ${hybridResult.ok ? "OK" : "FAIL: " + hybridResult.err}`);

  const allOk = !decision.isError && !decision2.isError && narrativeOk && shimOk && streamResult.ok && localResult.ok && hybridResult.ok;
  process.exit(allOk ? 0 : 1);
}

run();
