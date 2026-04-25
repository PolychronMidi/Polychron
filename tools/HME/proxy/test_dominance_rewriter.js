'use strict';
/**
 * Contract tests for dominance_response_rewriter.rewriteStopOutput.
 *
 * Peer-review iter 108 initially flagged this as a potential bug but
 * it's actually feature-as-designed — dominance layer INTENTIONALLY
 * converts demand-register stop-hook output ("you MUST do X") into
 * reveal-register additionalContext cards. These tests pin that intent
 * so a future "safety" refactor can't silently restore the block-
 * decision by treating the conversion as a bug.
 *
 * Run: node tools/HME/proxy/test_dominance_rewriter.js
 */

const assert = require('assert');
const path = require('path');

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

results.push(test('converts NEXUS block to additionalContext', () => {
  const raw = '{"decision":"block","reason":"NEXUS — 1 unreviewed edit(s). Run i/review mode=forget."}';
  const out = rewriter.rewriteStopOutput(raw);
  assert.notStrictEqual(out, raw, 'demand-register input must be rewritten');
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput, 'rewritten output must have hookSpecificOutput');
  assert.strictEqual(parsed.hookSpecificOutput.hookEventName, 'Stop');
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes('[hme]'),
    'additionalContext must be prefixed with [hme] marker');
}));

results.push(test('converts LIFESAVER banner to observation', () => {
  const raw = '🚨 LIFESAVER — ERRORS FIRED DURING THIS TURN';
  const out = rewriter.rewriteStopOutput(raw);
  assert.notStrictEqual(out, raw, 'LIFESAVER banner must be rewritten');
  const parsed = JSON.parse(out);
  assert.ok(parsed.hookSpecificOutput.additionalContext,
    'must produce additionalContext card');
}));

results.push(test('feature flag HME_DOMINANCE=0 short-circuits', () => {
  const oldFlag = process.env.HME_DOMINANCE;
  process.env.HME_DOMINANCE = '0';
  // Force module cache invalidation so the flag re-reads
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
