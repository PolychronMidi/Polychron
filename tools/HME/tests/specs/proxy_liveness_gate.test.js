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

test('a slot running a stale fingerprint is flagged drift (serves old code)', () => {
  const r = evaluateSlots({ a: health(), b: health({ runtime_fingerprint: 'OLD' }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].slot, 'b');
  assert.equal(r.problems[0].kind, 'drift');
});

test('a missing health file is flagged', () => {
  const r = evaluateSlots({ a: health(), b: null }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].kind, 'missing');
});

test('a dead pid is flagged even if the health file looks fresh', () => {
  const deps = { isAlive: (pid) => pid !== 666, staleMs: STALE_MS };
  const r = evaluateSlots({ a: health(), b: health({ pid: 666 }) }, 'GOOD', NOW, deps);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].kind, 'dead');
});

test('a stale heartbeat (old ts) is flagged', () => {
  const r = evaluateSlots({ a: health(), b: health({ ts: NOW - STALE_MS - 1 }) }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems[0].kind, 'stale');
});

test('BOTH slots down -> still one problem entry per slot (total proxy outage)', () => {
  const r = evaluateSlots({ a: null, b: null }, 'GOOD', NOW, aliveAll);
  assert.equal(r.ok, false);
  assert.equal(r.problems.length, 2);
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
