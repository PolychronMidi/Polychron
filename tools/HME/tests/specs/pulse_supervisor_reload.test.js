'use strict';
// Regression: the universal_pulse daemon is long-lived, so it caches every
// Python module it imports for its whole lifetime. universal_pulse_tick.py
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SUPERVISOR = path.join(REPO_ROOT, 'tools', 'HME', 'hooks', 'direct', 'universal-pulse-supervisor.sh');
const TICK = path.join(REPO_ROOT, 'tools', 'HME', 'activity', 'universal_pulse_tick.py');

test('pulse supervisor reload-watch includes the todo_engine modules the tick imports', () => {
  const sv = fs.readFileSync(SUPERVISOR, 'utf8');
  // The _up_code_mtime watch loop is the daemon's stale-code reload trigger.
  for (const mod of ['todo_engine/store.py', 'todo_engine/lifecycle.py', 'todo_engine/grammar.py']) {
    assert.ok(sv.includes(mod), `supervisor _up_code_mtime must watch ${mod} so a todo_engine edit reloads the daemon`);
  }
  // The tick really does import todo_engine -- the reason the watch is required.
  const tick = fs.readFileSync(TICK, 'utf8');
  assert.match(tick, /from todo_engine import store/, 'tick imports todo_engine (justifies the watch)');
  assert.match(tick, /maybe_archive\(\)/, 'tick drives maybe_archive (the archive trigger)');
});

test('pulse supervisor baselines an adopted child to its real start time, not now', () => {
  const sv = fs.readFileSync(SUPERVISOR, 'utf8');
  // Adopting a child without recording its true fork time would hide staleness:
  // a daemon forked before a code edit would be assumed current and never reload.
  assert.match(sv, /ps -o lstart= -p/, 'adoption must read the child process start time');
  assert.ok(!/_UP_CHILD_CODE_MTIME=\$\(_up_code_mtime\)\s*\n\s*_up_log "adopted/.test(sv),
    'adoption must NOT baseline to current code mtime (that hides a stale forked child)');
});
