'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');

const path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');
const { performReexec } = require('../../proxy/shuffler/self_reexec');

// performReexec(entryFile, argv, deps) returns a promise resolving to a verdict:
//   { action: 'exited' }            -- new child confirmed alive, old proc stepped down

function baseDeps(overrides = {}) {
  const calls = { exit: 0, alerts: [], logs: [] };
  const deps = {
    checkSyntax: () => ({ ok: true }),
    spawnFn: () => ({ pid: 4242, alive: true }),
    isAlive: (child) => child.alive,
    exitFn: () => { calls.exit += 1; },
    logFn: (m) => calls.logs.push(m),
    alertFn: (m) => calls.alerts.push(m),
    sleep: async () => {},
    graceMs: 1500,
    calls,
    ...overrides,
  };
  return deps;
}

test('happy path: new code parses and child stays alive -> old proc exits', async () => {
  const d = baseDeps();
  const verdict = await performReexec('/x/slot_watchdog.js', [], d);
  assert.equal(verdict.action, 'exited');
  assert.equal(d.calls.exit, 1);
  assert.equal(d.calls.alerts.length, 0);
});

test('syntax error in new code -> NEVER spawns, NEVER exits, keeps old proc, alerts', async () => {
  let spawned = false;
  const d = baseDeps({
    checkSyntax: () => ({ ok: false, error: 'Unexpected token }' }),
    spawnFn: () => { spawned = true; return { pid: 1, alive: true }; },
  });
  const verdict = await performReexec('/x/slot_watchdog.js', [], d);
  assert.equal(verdict.action, 'aborted');
  assert.match(verdict.reason, /syntax/i);
  assert.equal(spawned, false, 'must not spawn a known-broken child');
  assert.equal(d.calls.exit, 0, 'must not exit the working old proc');
  assert.equal(d.calls.alerts.length, 1);
  assert.match(d.calls.alerts[0], /LIFESAVER/);
});

test('child dies during grace window -> old proc stays alive, alerts, no exit', async () => {
  const child = { pid: 99, alive: true };
  const d = baseDeps({
    spawnFn: () => child,
    // child crashes on boot: alive flips false before the grace check
    sleep: async () => { child.alive = false; },
  });
  const verdict = await performReexec('/x/slot_watchdog.js', [], d);
  assert.equal(verdict.action, 'aborted');
  assert.match(verdict.reason, /died|crash/i);
  assert.equal(d.calls.exit, 0);
  assert.equal(d.calls.alerts.length, 1);
  assert.match(d.calls.alerts[0], /LIFESAVER/);
});

test('the abort alert line satisfies the LIFESAVER scanner contract', async () => {
  const LIFESAVER_TEXT_RE = /\[ALERT\]\s+LIFESAVER|\bLIFESAVER\s+--/;
  const INFO_WORDS = /\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/;
  const d = baseDeps({ checkSyntax: () => ({ ok: false, error: 'bad' }) });
  await performReexec('/x/slot_watchdog.js', [], d);
  assert.match(d.calls.alerts[0], LIFESAVER_TEXT_RE);
  assert.doesNotMatch(d.calls.alerts[0], INFO_WORDS);
});

test('module still exports watchSelfAndReexec', () => {
  const mod = require('../../proxy/shuffler/self_reexec');
  assert.equal(typeof mod.watchSelfAndReexec, 'function');
  assert.equal(typeof mod.performReexec, 'function');
});
