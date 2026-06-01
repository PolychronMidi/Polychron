'use strict';
// Dual-slot live-live admission + quarantine state machine. Locks the three
// guarantees the slot lifecycle must hold:

const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const slot = require('../../proxy/proxy_slot_lifecycle');

function tmpRuntime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slotstate-'));
  return path.join(dir, 'runtime');
}

test('fresh state admits any fingerprint (first boot, nothing proven or broken)', () => {
  const rt = tmpRuntime();
  assert.equal(slot.canAdmitFingerprint(rt, 'AAA').ok, true);
});

test('GUARANTEE 3: a fingerprint proven broken on one slot is quarantined from the other', () => {
  const rt = tmpRuntime();
  slot.markSlotStarting(rt, 'a', 'BAD');
  slot.markSlotBroken(rt, 'a', 'BAD', 'died before ready');
  const verdict = slot.canAdmitFingerprint(rt, 'BAD');
  assert.equal(verdict.ok, false, 'known-broken build must NOT be admitted to a second slot');
  assert.match(verdict.reason, /quarantined/);
});

test('GUARANTEE 2: a viable fingerprint is always admissible so the second slot can converge', () => {
  const rt = tmpRuntime();
  slot.markSlotStarting(rt, 'a', 'GOOD');
  slot.markSlotViable(rt, 'a', 'GOOD');
  // slot b must be allowed to converge onto the SAME viable code (zero-downtime update).
  assert.equal(slot.canAdmitFingerprint(rt, 'GOOD').ok, true);
});

test('quarantine clears once the SAME fingerprint later proves viable anywhere (flaky boot recovery)', () => {
  const rt = tmpRuntime();
  slot.markSlotBroken(rt, 'a', 'FLAKY', 'transient crash');
  assert.equal(slot.canAdmitFingerprint(rt, 'FLAKY').ok, false);
  slot.markSlotViable(rt, 'b', 'FLAKY');
  assert.equal(slot.canAdmitFingerprint(rt, 'FLAKY').ok, true, 'a since-proven build is no longer quarantined');
});

test('a different (new) fingerprint is never blocked by an old broken one (a fix must deploy)', () => {
  const rt = tmpRuntime();
  slot.markSlotBroken(rt, 'a', 'BROKEN_V1', 'syntax error');
  // The user fixes the bug -> new fingerprint. It must be admissible.
  assert.equal(slot.canAdmitFingerprint(rt, 'FIXED_V2').ok, true);
});

test('latestBrokenFingerprint reports the active quarantine and nothing once cleared', () => {
  const rt = tmpRuntime();
  assert.equal(slot.latestBrokenFingerprint(rt), '');
  slot.markSlotBroken(rt, 'a', 'X', 'boom');
  assert.equal(slot.latestBrokenFingerprint(rt), 'X');
  slot.markSlotViable(rt, 'a', 'X');
  assert.equal(slot.latestBrokenFingerprint(rt), '', 'cleared after the same code proves viable');
});

test('countSlotsWithFingerprint counts only ready+fresh+alive slots on that exact build', () => {
  const rt = tmpRuntime();
  fs.mkdirSync(rt, { recursive: true });
  const now = 1_000_000;
  const write = (s, obj) => fs.writeFileSync(path.join(rt, `proxy-${s}.health`), JSON.stringify(obj));
  write('a', { pid: 1, ts: now, ready: true, draining: false, runtime_fingerprint: 'CUR' });
  write('b', { pid: 2, ts: now, ready: true, draining: false, runtime_fingerprint: 'OLD' });
  const opts = { isAlive: () => true, staleMs: 5000, now };
  assert.equal(slot.countSlotsWithFingerprint(rt, 'CUR', opts), 1);
  // A draining slot on CUR is leaving rotation -> not counted as serving CUR.
  write('b', { pid: 2, ts: now, ready: true, draining: true, runtime_fingerprint: 'CUR' });
  assert.equal(slot.countSlotsWithFingerprint(rt, 'CUR', opts), 1);
  // Both ready+fresh+alive on CUR -> 2 (converged).
  write('b', { pid: 2, ts: now, ready: true, draining: false, runtime_fingerprint: 'CUR' });
  assert.equal(slot.countSlotsWithFingerprint(rt, 'CUR', opts), 2);
  // Stale heartbeat is not counted even if ready.
  write('b', { pid: 2, ts: now - 6000, ready: true, draining: false, runtime_fingerprint: 'CUR' });
  assert.equal(slot.countSlotsWithFingerprint(rt, 'CUR', opts), 1);
});

test('resetFingerprintState lifts a quarantine explicitly (operator/launch override)', () => {
  const rt = tmpRuntime();
  slot.markSlotBroken(rt, 'a', 'Q', 'boom');
  assert.equal(slot.canAdmitFingerprint(rt, 'Q').ok, false);
  slot.resetFingerprintState(rt, 'Q', 'manual clear');
  assert.equal(slot.canAdmitFingerprint(rt, 'Q').ok, true);
});
