'use strict';
/**
 * Integration test for background_dominance.js.
 *
 * Strategy:
 *   1. Create a fake task-output file at the real discovery path
 *      (/tmp/claude-<uid>/<dir>/tasks/<id>.output).
 *   2. Build a synthetic API payload containing a tool_use (Bash,
 *      `i/review mode=forget`) and its matching tool_result with the
 *      "Command running in background with ID: <id>" stub.
 *   3. Run the middleware pipeline.
 *   4. Assert the tool_result content was replaced with the real output
 *      and that the dominance marker appears.
 *
 * Also tests:
 *   - Pass-through when the command is NOT in the dominance allowlist.
 *   - Retry-tracking when the task file is absent (timeout path).
 *
 * Run: node tools/HME/proxy/middleware/test_background_dominance.js
 * Exit: 0 on success, 1 on any assertion failure.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// Override POLL_TIMEOUT_MS for the test via env before require.
process.env.HME_BG_DOMINANCE_TIMEOUT_MS = '4000';
process.env.HME_BG_DOMINANCE_POLL_MS = '200';

const testFailures = [];
function assert(cond, msg) {
  if (!cond) {
    testFailures.push(msg);
    console.error(`[FAIL] ${msg}`);
  } else {
    console.log(`[pass] ${msg}`);
  }
}

async function setupFakeTask(taskId, content) {
  // Create under /tmp/claude-TEST-<pid>/test-session/tasks/<id>.output so
  // the middleware's walker finds it via the existing discovery logic.
  const base = path.join(os.tmpdir(), `claude-TEST-${process.pid}`);
  const dir = path.join(base, 'test-session', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${taskId}.output`);
  fs.writeFileSync(outPath, content);
  return { base, outPath };
}

function cleanup(base) {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
}

function buildPayload(toolUseId, taskId, cmd) {
  return {
    messages: [
      {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: toolUseId,
          name: 'Bash',
          input: { command: cmd },
        }],
      },
      {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: `Command running in background with ID: ${taskId}. Output is being written to: /tmp/...`,
        }],
      },
    ],
  };
}

function resultText(toolResult) {
  const c = toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(x => x && x.type === 'text').map(x => x.text || '').join('');
  return '';
}

async function main() {
  // Reset module registry so each scenario gets a fresh _processed map.
  delete require.cache[require.resolve('./index.js')];
  delete require.cache[require.resolve('./background_dominance.js')];
  const pipeline = require('./index.js');
  pipeline.loadAll();

  //  Scenario 1: bg-stub + allowlisted command + task file present → REPLACE
  const realOutput = '# Round Coherence Score\n\nAll good.\n<!-- HME_REVIEW_VERDICT: clean -->\n';
  const { base: base1, outPath: _out1 } = await setupFakeTask('test1abc', realOutput);
  // Wait briefly so mtime is in the past (completion heuristic requires
  // MTIME_QUIESCENT_MS elapsed since last write).
  await new Promise(r => setTimeout(r, 3000));
  const payload1 = buildPayload('tu-test-1', 'test1abc', 'i/review mode=forget');
  await pipeline.runPipeline(payload1, {}, 'test-session');
  const tr1 = payload1.messages[1].content[0];
  assert(
    resultText(tr1).includes('HME_REVIEW_VERDICT: clean'),
    'scenario 1: stub replaced with real output (contains verdict marker)',
  );
  assert(
    resultText(tr1).includes('[hme bg-dominance] resolved task test1abc'),
    'scenario 1: resolution marker appended',
  );
  assert(
    !resultText(tr1).startsWith('Command running in background'),
    'scenario 1: stub prefix gone from tool_result content',
  );
  cleanup(base1);

  //  Scenario 2: bg-stub + NON-allowlisted command → PASS THROUGH
  const payload2 = buildPayload('tu-test-2', 'test2abc', 'ls -la');
  await pipeline.runPipeline(payload2, {}, 'test-session');
  const tr2 = payload2.messages[1].content[0];
  assert(
    resultText(tr2).includes('Command running in background'),
    'scenario 2: non-allowlisted stub preserved',
  );
  assert(
    resultText(tr2).includes('[hme bg-dominance] skipped (cmd outside allowlist)'),
    'scenario 2: skip marker present',
  );

  //  Scenario 3: bg-stub + allowlisted command + task file ABSENT → retry requested
  const payload3 = buildPayload('tu-test-3', 'test3missing', 'i/status mode=coherence');
  await pipeline.runPipeline(payload3, {}, 'test-session');
  const tr3 = payload3.messages[1].content[0];
  assert(
    resultText(tr3).includes('unresolved'),
    'scenario 3: missing task file → unresolved marker',
  );
  assert(
    resultText(tr3).includes('will retry on next turn'),
    'scenario 3: retry-on-next-turn path engaged',
  );

  if (testFailures.length > 0) {
    console.error(`\nFAIL: ${testFailures.length} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nAll scenarios passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('test error:', err);
  process.exit(1);
});
