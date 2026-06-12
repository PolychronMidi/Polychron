'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { isSlotRoutable, isPidAlive } = require('../../proxy/shared/slot_routable');

// isSlotRoutable(health, { now, staleMs, isAlive }) is pure with injected deps.
const NOW = 1_000_000;
const STALE_MS = 5_000;
function health(over = {}) {
  return { pid: 100, ts: NOW, ready: true, draining: false, ...over };
}
const aliveAll = { now: NOW, staleMs: STALE_MS, isAlive: () => true };

test('fresh + ready + not-draining + pid alive -> routable', () => {
  assert.equal(isSlotRoutable(health(), aliveAll), true);
});

test('REGRESSION: a dead pid is NOT routable even when the stale health still says ready:true', () => {
  // The 2026-06-02 poison pill: a corpse advertising ready:true,draining:false.
  const deps = { now: NOW, staleMs: STALE_MS, isAlive: (pid) => pid !== 666 };
  assert.equal(isSlotRoutable(health({ pid: 666 }), deps), false);
});

test('draining slot is not routable', () => {
  assert.equal(isSlotRoutable(health({ draining: true }), aliveAll), false);
});

test('not-ready slot is not routable', () => {
  assert.equal(isSlotRoutable(health({ ready: false }), aliveAll), false);
});

test('stale heartbeat is not routable (even if alive+ready)', () => {
  assert.equal(isSlotRoutable(health({ ts: NOW - STALE_MS - 1 }), aliveAll), false);
});

test('missing / null health is not routable', () => {
  assert.equal(isSlotRoutable(null, aliveAll), false);
  assert.equal(isSlotRoutable(undefined, aliveAll), false);
});

test('REGRESSION min-1 guard: dead-but-fresh slot + missing slot => routable count 0', () => {
  // Exact incident shape: slot b dead-but-fresh (ready:true), slot a missing.
  // Pre-fix the watchdog counted b as routable (no pid check) so the min-1 guard
  const slots = { a: null, b: health({ pid: 3865148 }) };
  const isAlive = (pid) => pid !== 3865148; // b's pid is dead
  let routable = 0;
  for (const s of ['a', 'b']) {
    if (isSlotRoutable(slots[s], { now: NOW, staleMs: STALE_MS, isAlive })) routable += 1;
  }
  assert.equal(routable, 0);
});

test('isPidAlive: current process alive; impossible/invalid pids not alive', () => {
  assert.equal(isPidAlive(process.pid), true);
  assert.equal(isPidAlive(0), false);
  assert.equal(isPidAlive(-1), false);
  assert.equal(isPidAlive('nope'), false);
  assert.equal(isPidAlive(2 ** 31 - 1), false);
});
