'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSlots, formatLifesaver } = require('../../proxy/proxy_liveness_gate');

// evaluateSlots(slots, wantedFingerprint, now, deps) is pure:
//   slots: { a: <healthObj|null>, b: <healthObj|null> }
const NOW = 1_000_000;
const STALE_MS = 30_000;
function health(over = {}) {
  return { pid: 100, ts: NOW, ready: true, draining: false, runtime_fingerprint: 'GOOD', ...over };
}
const aliveAll = { isAlive: () => true, staleMs: STALE_MS };

test('both slots fresh, alive, current fingerprint -> ok', () => {
  const r = evaluateSlots({ a: health(), b: health() }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 0);
});

test('drift is benign while at least one slot is routable during edit rollout', () => {
  const r = evaluateSlots({ a: health(), b: health({ runtime_fingerprint: 'OLD' }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, true);
  assert.equal(r.problems.length, 0);
});

test('a lone missing slot is BENIGN while the other serves current code (zero-downtime rotation)', () => {
  const r = evaluateSlots({ a: health(), b: null }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, true, 'one slot rotating must not alarm when the other is routable-current');
  assert.equal(r.problems.length, 0);
});

test('a lone dead slot is BENIGN while the other serves current code', () => {
  const deps = { isAlive: (pid) => pid !== 666, staleMs: STALE_MS };
  const r = evaluateSlots({ a: health(), b: health({ pid: 666 }) }, 'GOOD', NOW, deps);
  assert.equal(r.ok, true);
});

test('a lone stale slot is BENIGN while the other serves current code', () => {
  const r = evaluateSlots({ a: health(), b: health({ ts: NOW - STALE_MS - 1 }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, true);
});

test('all slots down or unroutable alarms', () => {
  const r = evaluateSlots({ a: health({ ready: false }), b: health({ draining: true }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems.map((p) => p.kind).sort().join(','), 'draining,not-ready');
});

test('BOTH slots down -> total outage alarms (no routable-current slot)', () => {
  const r = evaluateSlots({ a: null, b: null }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
});

test('one down + one old-code routable slot remains available', () => {
  const r = evaluateSlots({ a: null, b: health({ runtime_fingerprint: 'OLD' }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, true);
});

test('formatLifesaver line satisfies the UserPromptSubmit scanner contract', () => {
  const LIFESAVER_TEXT_RE = /\[ALERT\]\s+LIFESAVER|\bLIFESAVER\s+--/;
  const INFO_WORDS = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
  const line = formatLifesaver([{ slot: 'b', kind: 'drift', detail: 'live=OLD wanted=GOOD' }]);
  assert.match(line, LIFESAVER_TEXT_RE);
  assert.doesNotMatch(line, INFO_WORDS);
  assert.match(line, /drift/);
  assert.match(line, /slot b/);
});

test('formatLifesaver returns empty string when there are no problems', () => {
  assert.equal(formatLifesaver([]), '');
});
