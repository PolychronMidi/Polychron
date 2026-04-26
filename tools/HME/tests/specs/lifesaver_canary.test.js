'use strict';
// Regression: lifesaver.sh's "UNADDRESSED ERRORS FROM PREVIOUS TURN" branch
// must apply the same canary-consume + severity-classification filtering as
// the new-errors branch. Previously only the new-errors branch filtered;
// the watermark-lag branch surfaced everything raw, so a canary written
// between turns false-blocked the agent. This test plants a canary in a
// sandboxed errors.log with watermarks lagging, runs lifesaver.sh, and
// asserts no block decision and watermark advancement.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// branch: 'unaddressed' (default) places watermarks behind the planted lines
// so the WATERMARK_LINE < TURN_START_LINE branch fires. 'new' places
// watermarks AT the start of planted lines so the TOTAL > TURN_START_LINE
// (new-errors-this-turn) branch fires.
function _withLifesaverSandbox(canaryLines, opts = {}) {
  const branch = opts.branch || 'unaddressed';
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-lifesaver-test-'));
  fs.mkdirSync(path.join(sandbox, 'log'), { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'tmp'), { recursive: true });
  const errLog = path.join(sandbox, 'log', 'hme-errors.log');
  fs.writeFileSync(errLog, canaryLines.join('\n') + '\n');
  if (branch === 'new') {
    // Watermarks AT 0 so all planted lines are "new this turn".
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.lastread'), '0');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.turnstart'), '0');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.inline-watermark'), '0');
  } else {
    // Watermarks lag behind so the UNADDRESSED branch fires.
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.lastread'), '0');
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.turnstart'), String(canaryLines.length));
    fs.writeFileSync(path.join(sandbox, 'tmp', 'hme-errors.inline-watermark'), '0');
  }
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const lifesaverPath = path.join(repoRoot, 'tools', 'HME', 'hooks', 'lifecycle', 'stop', 'lifesaver.sh');
  // Source lifesaver inside a bash -c that stubs _stderr_verdict and exports
  // the sandbox PROJECT/PROJECT_ROOT. lifesaver.sh exits 0 in the alert
  // paths, so we capture stdout directly.
  const wrapper = `
    PROJECT='${sandbox}'
    PROJECT_ROOT='${sandbox}'
    _stderr_verdict() { echo "[verdict] $1" >&2; }
    export PROJECT PROJECT_ROOT
    source '${lifesaverPath}'
  `;
  const result = spawnSync('bash', ['-c', wrapper], { encoding: 'utf8' });
  return {
    sandbox,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    consumedFile: path.join(sandbox, 'tmp', 'hme-canary-consumed.txt'),
    watermarkFile: path.join(sandbox, 'tmp', 'hme-errors.lastread'),
    cleanup: () => { try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_e) { /* best-effort */ } },
  };
}

test('lifesaver: UNADDRESSED branch consumes canary without blocking', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [CANARY-canary-test123-456] alert-chain self-test injection',
  ]);
  try {
    // jq pretty-prints with `"key": "value"` (space after colon); match
    // either compact or pretty-print form.
    assert.ok(
      !/"decision"\s*:\s*"block"/.test(r.stdout),
      `lifesaver wrongly blocked on canary-only payload. stdout: ${r.stdout}`,
    );
    const watermark = fs.readFileSync(r.watermarkFile, 'utf8').trim();
    assert.strictEqual(watermark, '1', 'watermark must advance past consumed canary');
    assert.ok(fs.existsSync(r.consumedFile), 'canary-consumed.txt must be created');
    const consumed = fs.readFileSync(r.consumedFile, 'utf8');
    assert.ok(
      consumed.includes('canary-test123-456|consumed-by-stop'),
      `canary not marked consumed. file content: ${consumed}`,
    );
  } finally {
    r.cleanup();
  }
});

test('lifesaver: UNADDRESSED branch silent on observation-severity entries', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [universal_pulse] WARN p95 latency over threshold',
  ]);
  try {
    assert.ok(
      !/"decision"\s*:\s*"block"/.test(r.stdout),
      `lifesaver wrongly blocked on WARN-only payload. stdout: ${r.stdout}`,
    );
    // Self-origin observations surface as additionalContext, not block.
    if (r.stdout) {
      assert.ok(
        r.stdout.includes('hme self-health') || r.stdout.includes('observability only'),
        `expected additionalContext for self-only observation, got: ${r.stdout}`,
      );
    }
  } finally {
    r.cleanup();
  }
});

test('lifesaver: UNADDRESSED branch BLOCKS on real agent-origin error', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [some_module] context_meter.py: ImportError: no module named foo',
  ]);
  try {
    assert.ok(
      /"decision"\s*:\s*"block"/.test(r.stdout),
      `lifesaver must block on agent-origin error. stdout: ${r.stdout}`,
    );
    assert.ok(
      r.stdout.includes('UNADDRESSED ERRORS FROM PREVIOUS TURN'),
      'block reason must reference UNADDRESSED branch',
    );
  } finally {
    r.cleanup();
  }
});

test('lifesaver: UNADDRESSED branch with mixed canary+agent-error → blocks on agent, consumes canary', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [CANARY-canary-mix-789] alert-chain self-test injection',
    '[2026-04-26T07:00:01Z] [foo] real agent-actionable failure',
  ]);
  try {
    assert.ok(
      /"decision"\s*:\s*"block"/.test(r.stdout),
      `must block on the agent-origin error in the mix. stdout: ${r.stdout}`,
    );
    assert.ok(
      r.stdout.includes('real agent-actionable failure'),
      'block reason must include the agent-error line',
    );
    assert.ok(
      !r.stdout.includes('CANARY-'),
      'block reason must NOT include the canary line (canary should be consumed silently)',
    );
    // Canary still gets marked consumed even when accompanying agent error blocks.
    const consumed = fs.readFileSync(r.consumedFile, 'utf8');
    assert.ok(
      consumed.includes('canary-mix-789|consumed-by-stop'),
      'canary must be marked consumed even when sibling agent error blocks',
    );
  } finally {
    r.cleanup();
  }
});

test('lifesaver: NEW-ERRORS branch consumes canary without blocking', () => {
  const r = _withLifesaverSandbox(
    ['[2026-04-26T07:00:00Z] [CANARY-canary-newbranch-111] alert-chain self-test injection'],
    { branch: 'new' },
  );
  try {
    assert.ok(
      !/"decision"\s*:\s*"block"/.test(r.stdout),
      `new-errors branch wrongly blocked on canary-only payload. stdout: ${r.stdout}`,
    );
    assert.ok(fs.existsSync(r.consumedFile), 'canary-consumed.txt must exist');
    const consumed = fs.readFileSync(r.consumedFile, 'utf8');
    assert.ok(
      consumed.includes('canary-newbranch-111|consumed-by-stop'),
      'new-errors branch must mark canary consumed',
    );
  } finally {
    r.cleanup();
  }
});

test('lifesaver: source-tag self-origin overrides CRITICAL severity', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [universal_pulse] CRITICAL worker CPU-saturated (avg=113% over 90s)',
    '[2026-04-26T07:00:01Z] [llamacpp_supervisor] CRITICAL coder unreachable',
  ]);
  try {
    // These are CRITICAL but tagged with self-origin writer names —
    // must NOT block. Agent has no causal path to fix worker CPU
    // saturation or supervisor-managed daemon outage.
    assert.ok(
      !/"decision"\s*:\s*"block"/.test(r.stdout),
      `lifesaver wrongly blocked on self-tagged CRITICAL. stdout: ${r.stdout}`,
    );
    // Should surface as additionalContext (observation-only).
    if (r.stdout) {
      assert.ok(
        r.stdout.includes('hme self-health') || r.stdout.includes('observability only'),
        `expected additionalContext for self-tagged CRITICAL, got: ${r.stdout}`,
      );
    }
  } finally {
    r.cleanup();
  }
});

test('lifesaver: source-tag self-origin separates from real agent CRITICAL', () => {
  const r = _withLifesaverSandbox([
    '[2026-04-26T07:00:00Z] [universal_pulse] CRITICAL worker CPU-saturated',
    '[2026-04-26T07:00:01Z] [some_real_module] context_meter.py: ImportError: foo',
  ]);
  try {
    // Mixed: pulse is self-origin (skipped), real module is agent-origin
    // (must block on it).
    assert.ok(
      /"decision"\s*:\s*"block"/.test(r.stdout),
      `lifesaver must block on real agent error in mix. stdout: ${r.stdout}`,
    );
    assert.ok(
      r.stdout.includes('context_meter.py'),
      'block reason must reference the agent error',
    );
    // The pulse line should appear in the [self-origin] section, not the agent block.
    assert.ok(
      r.stdout.includes('self-origin') && r.stdout.includes('universal_pulse'),
      'pulse CRITICAL must be classified as self-origin, not agent',
    );
  } finally {
    r.cleanup();
  }
});

test('lifesaver: NEW-ERRORS branch BLOCKS on agent-origin error', () => {
  const r = _withLifesaverSandbox(
    ['[2026-04-26T07:00:00Z] [bar] another real failure'],
    { branch: 'new' },
  );
  try {
    assert.ok(
      /"decision"\s*:\s*"block"/.test(r.stdout),
      `new-errors branch must block on agent error. stdout: ${r.stdout}`,
    );
    assert.ok(
      r.stdout.includes('AGENT-ORIGIN ERRORS FIRED THIS TURN'),
      'block reason must reference new-errors branch banner text',
    );
  } finally {
    r.cleanup();
  }
});
