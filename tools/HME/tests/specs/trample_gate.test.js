'use strict';
/**
 * Trample-gate matcher contract.
 *
 * Regression guard: the gate previously keyed on the literal
 * `<system-reminder>\nThe user sent a new message while you were working`
 * wrapper. Real mid-turn interrupts arrive with the stable PHRASE but not
 * always that exact wrapper prefix, so the gate silently no-opped on every
 * real interrupt. These cases pin the gate to the stable phrase and prove it
 * fires on the real shape, stays back-compat on the wrapped shape, ignores
 * normal messages, and is idempotent.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const gate = require('../../proxy/middleware/25a_trample_gate.js');

function _run(content) {
  const payload = { messages: [{ role: 'user', content }] };
  let dirty = false;
  gate.onRequest({ payload, ctx: { markDirty() { dirty = true; } } });
  const injected = Array.isArray(payload.system)
    && payload.system.some((s) => s && typeof s.text === 'string' && s.text.includes('[trample-gate -- proxy-injected]'));
  return { payload, dirty, injected };
}

test('fires on the REAL plain-phrase interrupt (no <system-reminder> wrapper)', () => {
  const r = _run('do stuff\n\nThe user sent a new message while you were working:\nwhy did you do that?');
  assert.equal(r.injected, true, 'gate must inject ack-instruction on the plain real interrupt phrase');
  assert.equal(r.dirty, true, 'gate must mark the payload dirty so it re-serializes');
});

test('still fires on the wrapped <system-reminder> interrupt (back-compat)', () => {
  const r = _run('<system-reminder>\nThe user sent a new message while you were working\n</system-reminder>');
  assert.equal(r.injected, true);
  assert.equal(r.dirty, true);
});

test('does NOT fire on a normal message', () => {
  const r = _run('please continue with the task');
  assert.equal(r.injected, false);
  assert.equal(r.dirty, false);
  assert.ok(!Array.isArray(r.payload.system) || r.payload.system.length === 0);
});

test('is idempotent: second pass does not double-inject', () => {
  const payload = { messages: [{ role: 'user', content: 'The user sent a new message while you were working: stop' }] };
  let dirty1 = false; gate.onRequest({ payload, ctx: { markDirty() { dirty1 = true; } } });
  let dirty2 = false; gate.onRequest({ payload, ctx: { markDirty() { dirty2 = true; } } });
  const injections = payload.system.filter((s) => s && typeof s.text === 'string' && s.text.includes('[trample-gate -- proxy-injected]'));
  assert.equal(injections.length, 1, 'exactly one ack-instruction must be present after two passes');
  assert.equal(dirty1, true);
  assert.equal(dirty2, false, 'second pass must be a no-op (no re-inject, no markDirty)');
});

test('fires when the interrupt phrase is in an array content block', () => {
  const payload = { messages: [{ role: 'user', content: [{ type: 'text', text: 'The user sent a new message while you were working: why' }] }] };
  let dirty = false;
  gate.onRequest({ payload, ctx: { markDirty() { dirty = true; } } });
  assert.ok(payload.system.some((s) => s.text.includes('[trample-gate -- proxy-injected]')));
  assert.equal(dirty, true);
});
