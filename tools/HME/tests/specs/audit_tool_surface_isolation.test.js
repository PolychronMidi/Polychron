'use strict';
// Regression tests for audit-tool-surface.py's cgroup isolation
// invocation construction. Verifies that probe commands ARE wrapped
// with `systemd-run --scope` + the documented resource caps, without
// actually running a fork-bomb (which would risk another host crash
// even with isolation in place — proving the containment empirically
// requires controlled experimentation outside this test harness).
//
// What's tested here: argument-construction discipline. If anyone
// later edits `_run()` to drop systemd-run or weaken the caps, this
// test fires.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..', '..', '..');
const AUDIT_SCRIPT = path.join(REPO, 'scripts', 'hme', 'audit-tool-surface.py');

test('audit-tool-surface: _run wraps with systemd-run --scope', () => {
  const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
  // Required wrapping
  assert.match(src, /"systemd-run"/, 'must invoke systemd-run');
  assert.match(src, /"--scope"/, 'must use --scope (transient unit)');
  assert.match(src, /"--user"/, 'must run in user instance (no root needed)');
  // Required caps
  assert.match(src, /MemoryMax=512M/,
    'must cap memory at 512M to bound runaway allocation');
  assert.match(src, /CPUQuota=100%/,
    'must cap CPU at 100% (one core) to prevent fork-bomb amplification');
  assert.match(src, /TasksMax=64/,
    'must cap descendant task count at 64');
  assert.match(src, /RuntimeMaxSec=/,
    'must enforce runtime cap (ties to per-probe timeout)');
});

test('audit-tool-surface: refuses to run if systemd-run unavailable', () => {
  const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
  assert.match(src, /_systemd_run_available/,
    'must check systemd-run availability before running');
  // Pattern is split across two adjacent string literals in the
  // source (`"...required for safe " "subprocess isolation..."`),
  // so regex against the source text needs to allow for either.
  assert.match(
    src,
    /systemd-run is required/,
    'must surface a clear refusal when isolation is unavailable',
  );
});

test('audit-tool-surface: SAFE_NO_ARGS_ALLOWLIST is an explicit allowlist (not blocklist)', () => {
  const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
  // Inversion check: must use ALLOWLIST shape (`name in ALLOWLIST`)
  // not the prior blocklist shape (`name not in DESTRUCTIVE`). The
  // blocklist let new tools default to "probe everything" which is
  // exactly the failure mode that crashed the host — new heavy tools
  // would be auto-probed before being reviewed.
  assert.match(src, /SAFE_NO_ARGS_ALLOWLIST\s*=\s*\{/,
    'must define SAFE_NO_ARGS_ALLOWLIST as a set');
  assert.match(src, /name in SAFE_NO_ARGS_ALLOWLIST/,
    'must check membership against allowlist');
  assert.doesNotMatch(src, /DESTRUCTIVE_NO_ARGS_DEFAULT/,
    'must NOT keep the prior blocklist around (footgun)');
});

test('audit-tool-surface: typo probe uses an action= arg unlikely to collide', () => {
  // The typo arg is 'action=garbage-mode-xyz'. If a tool LEGITIMATELY
  // accepted action=garbage-mode-xyz, the rubric would false-pass.
  // Verify the chosen typo is unlikely to be real.
  const src = fs.readFileSync(AUDIT_SCRIPT, 'utf8');
  assert.match(src, /action=garbage-mode-xyz/,
    'typo probe arg should be the documented sentinel');
  // Sanity: this string SHOULD NOT appear anywhere in the project
  // outside the audit script + this test (would mean it's a real arg).
  // Best-effort scan of likely registry locations.
  const registryFiles = [
    path.join(REPO, 'tools', 'HME', 'i_registry.json'),
    path.join(REPO, 'tools', 'HME', 'config', 'invariants.json'),
  ];
  for (const f of registryFiles) {
    if (!fs.existsSync(f)) continue;
    const content = fs.readFileSync(f, 'utf8');
    assert.ok(
      !content.includes('garbage-mode-xyz'),
      `${f} contains the typo sentinel — pick a different sentinel for the probe`,
    );
  }
});
