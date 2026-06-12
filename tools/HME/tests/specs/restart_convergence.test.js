'use strict';
// Bulletproof regression lock for proxy auto-liveness convergence.
// The bug: under rapid churn (autocommit), a change arriving while a restart

const assert = require('node:assert/strict');
const test = require('node:test');
const { createRestartCoordinator } = require('../../proxy/shuffler/restart_coordinator');

// Drive a coordinator with an event script. The harness models the watcher's
// real wiring: onChange may arm a timer; a timer eventually elapses; a restart
function runScript(events) {
  const c = createRestartCoordinator();
  let timerArmed = false;
  for (const ev of events) {
    if (ev === 'change') {
      const r = c.onChange('f.js');
      if (r.schedule) timerArmed = true;
    } else if (ev === 'timer' && timerArmed) {
      timerArmed = false;
      const restart = c.onDebounceElapsed();
      if (restart) { /* restart now running; finishes on a 'done' event */ }
    } else if (ev === 'done') {
      const chained = c.onRestartDone();
      if (chained) { /* chained restart running; finishes on a later 'done' */ }
    }
    // INVARIANT during the run: never stranded with a timer also disarmed.
    if (c.isStranded() && !timerArmed) {
      assert.fail(`stranded mid-script after ${ev}: ${JSON.stringify(c._state)}`);
    }
  }
  // Quiesce: fire any armed timer, then drain all in-flight restarts.
  if (timerArmed) { timerArmed = false; c.onDebounceElapsed(); }
  let guard = 0;
  while (!c.isSettled()) {
    if (++guard > 1000) assert.fail(`did not settle: ${JSON.stringify(c._state)}`);
    if (c._state.scheduled) { c.onDebounceElapsed(); continue; }
    if (c._state.inFlight) { c.onRestartDone(); continue; }
    // pending but neither scheduled nor in-flight == stranded; arm+fire.
    if (c.isStranded()) assert.fail(`stranded at quiesce: ${JSON.stringify(c._state)}`);
  }
  assert.ok(c.isSettled());
}

test('change while restart in-flight is never dropped (the core bug)', () => {
  // change -> timer fires (restart A in flight) -> change (must NOT be lost)
  // -> done (must chain restart B for the new code) -> done -> settled.
  const c = createRestartCoordinator();
  c.onChange('f.js');
  const first = c.onDebounceElapsed();
  assert.ok(first, 'first restart should fire');
  c.onChange('f.js');                          // arrives mid-restart
  assert.ok(c._state.pendingPath != null, 'mid-restart change retained');
  const chained = c.onRestartDone();
  assert.ok(chained, 'must chain a restart for the change that landed mid-flight');
  const none = c.onRestartDone();
  assert.equal(none, null);
  assert.ok(c.isSettled());
});

test('failed restart can clear queued work and settle on last-viable fallback', () => {
  const c = createRestartCoordinator();
  c.onChange('f.js');
  const first = c.onDebounceElapsed();
  assert.ok(first, 'first restart should fire');
  c.onChange('g.js');
  assert.equal(c.isSettled(), false);
  const chained = c.onRestartDone({ failed: true, clearPending: true });
  assert.equal(chained, null);
  assert.ok(c.isSettled());
});

test('exhaustive: all event sequences up to length 7 settle without stranding', () => {
  const alphabet = ['change', 'timer', 'done'];
  function* seqs(n) {
    if (n === 0) { yield []; return; }
    for (const head of alphabet) for (const tail of seqs(n - 1)) yield [head, ...tail];
  }
  let count = 0;
  for (let len = 0; len <= 7; len++) {
    for (const s of seqs(len)) { runScript(s); count++; }
  }
  assert.ok(count > 3000, `ran ${count} sequences`);
});

test('randomized churn storm: 20000 random sequences never strand', () => {
  // deterministic LCG so the test is reproducible without Math.random.
  let seed = 0x2545F491;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const alphabet = ['change', 'change', 'timer', 'done'];   // change-weighted
  for (let i = 0; i < 20000; i++) {
    const len = 1 + Math.floor(rnd() * 40);
    const s = Array.from({ length: len }, () => alphabet[Math.floor(rnd() * alphabet.length)]);
    runScript(s);
  }
});
