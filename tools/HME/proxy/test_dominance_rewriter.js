'use strict';
/**
 * Contract tests for dominance_response_rewriter.rewriteStopOutput.
 *
 * UPDATED: rewriteStopOutput is now PERMANENTLY a no-op (always returns
 * raw input). The previous "convert demand to reveal-register" behavior
 * was stripping actionable AUTO-COMPLETENESS / LIFESAVER / EXHAUST
 * directives from Stop output before they reached the agent. The user
 * repeatedly screamed "auto-completeness still didn't fire" because this
 * rewriter was eating the directive content. These tests now PIN the
 * no-op behavior so a future "let's re-enable dominance" refactor must
 * either: (a) leave rewriteStopOutput a pure passthrough, or (b)
 * fundamentally invert the rewrite to ENHANCE not strip (annotate
 * alongside the original directive, never replace).
 *
 * Run: node tools/HME/proxy/test_dominance_rewriter.js
 */

const assert = require('assert');
const path = require('path');

// Test with flag explicitly ON. The pre-fix behavior would have rewritten;
// the post-fix behavior must passthrough regardless of flag state.
process.env.HME_DOMINANCE = '1';
const rewriter = require('./middleware/dominance_response_rewriter');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    return false;
  }
}

const results = [];

results.push(test('passthrough on non-demand output', () => {
  const raw = '{"stdout":"ok","exit_code":0}';
  const out = rewriter.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'non-demand output must pass through unchanged');
}));

results.push(test('NEXUS block preserved unchanged (no rewrite)', () => {
  const raw = '{"decision":"block","reason":"NEXUS — 1 unreviewed edit(s). Run i/review mode=forget."}';
  const out = rewriter.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'NEXUS block must NOT be rewritten -- the directive content must reach the agent');
}));

results.push(test('LIFESAVER banner preserved unchanged (no rewrite)', () => {
  const raw = '🚨 LIFESAVER — ERRORS FIRED DURING THIS TURN';
  const out = rewriter.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'LIFESAVER banner must NOT be rewritten -- alert content must reach the agent');
}));

results.push(test('AUTO-COMPLETENESS preserved unchanged (no rewrite)', () => {
  const raw = '{"decision":"block","reason":"AUTO-COMPLETENESS INJECT (round 1/2): Before stopping, enumerate everything that might still be missing..."}';
  const out = rewriter.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'AUTO-COMPLETENESS directive must NOT be rewritten -- this was the recurring silent-fail vector');
}));

results.push(test('EXHAUST PROTOCOL preserved unchanged (no rewrite)', () => {
  const raw = '{"decision":"block","reason":"EXHAUST PROTOCOL VIOLATION: Final text enumerated remaining items..."}';
  const out = rewriter.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'EXHAUST PROTOCOL directive must NOT be rewritten');
}));

results.push(test('feature flag HME_DOMINANCE=0 also passthrough (regression: was already correct, pin)', () => {
  const oldFlag = process.env.HME_DOMINANCE;
  process.env.HME_DOMINANCE = '0';
  delete require.cache[require.resolve('./middleware/dominance_response_rewriter')];
  const r2 = require('./middleware/dominance_response_rewriter');
  const raw = '{"decision":"block","reason":"NEXUS — 1 unreviewed edit(s)."}';
  const out = r2.rewriteStopOutput(raw);
  assert.strictEqual(out, raw, 'with flag=0, output must be unchanged');
  process.env.HME_DOMINANCE = oldFlag;
  delete require.cache[require.resolve('./middleware/dominance_response_rewriter')];
}));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
