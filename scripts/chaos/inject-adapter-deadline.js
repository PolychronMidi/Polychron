#!/usr/bin/env node
/**
 * Chaos injector: construct a RouterAdapter whose legacy launch function
 * never calls onDone -- simulating a stuck/hung backend. Assert that the
 * adapter's deadlineMs fires and resolves the Promise with ok=false and
 * a "wall deadline" error.
 *
 * A probe-test for the wall-clock cap we wired into chatStreaming: if
 * deadlineMs stops working, a hung Claude PTY or llama-server could
 * freeze the chat indefinitely. This catches silent regressions in
 * RouterInterface.wrapLegacyStream's timer path.
 *
 * Run: node scripts/chaos/inject-adapter-deadline.js
 * Exit 0 on pass, 1 on fail.
 */
'use strict';

const path = require('path');
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const CHAT_OUT = path.join(PROJECT_ROOT, 'tools', 'HME', 'chat', 'out');

function _require(rel) {
  return require(path.join(CHAT_OUT, rel));
}

(async () => {
  let RouterInterface;
  try {
    RouterInterface = _require('routers/RouterInterface.js');
  } catch (e) {
    console.error(`FAIL: cannot load RouterInterface (was chat compiled?): ${e.message}`);
    process.exit(1);
  }

  const { wrapLegacyStream } = RouterInterface;
  if (typeof wrapLegacyStream !== 'function') {
    console.error('FAIL: wrapLegacyStream not exported from RouterInterface');
    process.exit(1);
  }

  // Build an adapter whose launch never calls onDone/onError. Only
  // deadlineMs should rescue it.
  const stuckAdapter = wrapLegacyStream(
    'local',
    'chaos-stuck',
    (_messages, _opts, cb) => {
      // Emit one chunk to prove the stream is alive, then do nothing
      // until cancel() is called.
      cb.chunk('pretend-tokens', 'text');
      return () => {};  // cancel function that does nothing
    },
  );

  const deadline = 500;  // 500ms -- short for a test
  const t0 = Date.now();
  const handle = stuckAdapter.stream([{ role: 'user', content: 'hi' }], {
    onChunk: () => {},
    deadlineMs: deadline,
  });
  const result = await handle.done;
  const elapsed = Date.now() - t0;

  // Expectations
  const expectations = [
    { name: 'result.ok === false', actual: result.ok, expected: false },
    { name: 'result.error mentions "deadline"', actual: /deadline/i.test(result.error || ''), expected: true },
    { name: 'elapsed >= deadline', actual: elapsed >= deadline, expected: true },
    { name: 'elapsed < deadline * 3 (not hung)', actual: elapsed < deadline * 3, expected: true },
  ];

  let passed = 0, failed = 0;
  for (const ex of expectations) {
    if (ex.actual === ex.expected) {
      console.log(`  PASS: ${ex.name}`);
      passed++;
    } else {
      console.log(`  FAIL: ${ex.name} -- got ${JSON.stringify(ex.actual)}, expected ${JSON.stringify(ex.expected)}`);
      failed++;
    }
  }

  if (failed === 0) {
    console.log(`\nchaos PASS: deadlineMs fired after ${elapsed}ms (cap ${deadline}ms); wall-clock cap is alive`);
    process.exit(0);
  } else {
    console.log(`\nchaos FAIL: ${failed}/${expectations.length} expectations missed; RouterInterface deadline path is broken`);
    console.log(`  raw result: ${JSON.stringify(result).slice(0, 300)}`);
    process.exit(1);
  }
})().catch((e) => {
  console.error(`chaos FAIL (uncaught): ${e && e.message ? e.message : e}`);
  process.exit(1);
});
