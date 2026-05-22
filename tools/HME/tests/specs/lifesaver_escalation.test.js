'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { lifesaverEscalation, evaluateBashInput } = require('../../proxy/bash_command_policy');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifesaver-esc-'));
  fs.mkdirSync(path.join(root, 'tools', 'HME', 'runtime'), { recursive: true });
  return root;
}
function writeSince(root, age_seconds) {
  const ts = Math.floor(Date.now() / 1000) - age_seconds;
  fs.writeFileSync(path.join(root, 'tools/HME/runtime/lifesaver-escalation-since.ts'), `${ts}\n`);
}

test('no state file -> no escalation, Bash allowed', () => {
  const root = sandbox();
  try {
    assert.equal(lifesaverEscalation(root), null);
    const r = evaluateBashInput({ command: 'echo hi' }, { projectRoot: root });
    assert.notEqual(r.decision, 'deny');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('state file <5min old -> no escalation', () => {
  const root = sandbox();
  try {
    writeSince(root, 60);
    assert.equal(lifesaverEscalation(root), null);
    const r = evaluateBashInput({ command: 'echo hi' }, { projectRoot: root });
    assert.notEqual(r.decision, 'deny', 'fresh streak does not block bash');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('state file >5min old -> Bash denied with escalation reason', () => {
  const root = sandbox();
  try {
    writeSince(root, 360);
    const esc = lifesaverEscalation(root);
    assert.equal(esc.decision, 'deny');
    assert.match(esc.reason, /LIFESAVER ESCALATION/);
    assert.match(esc.reason, /Bash unblocks automatically/);
    const r = evaluateBashInput({ command: 'echo blocked-by-escalation' }, { projectRoot: root });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /LIFESAVER ESCALATION/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('malformed state file does not deny (graceful)', () => {
  const root = sandbox();
  try {
    fs.writeFileSync(path.join(root, 'tools/HME/runtime/lifesaver-escalation-since.ts'), 'not-a-number\n');
    assert.equal(lifesaverEscalation(root), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exactly at threshold (300s) does NOT deny; one second past does', () => {
  const root = sandbox();
  try {
    writeSince(root, 299);
    assert.equal(lifesaverEscalation(root), null, 'below threshold is fine');
    writeSince(root, 301);
    const esc = lifesaverEscalation(root);
    assert.equal(esc && esc.decision, 'deny', 'past threshold denies');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('escalation precedes other gates: empty cmd still short-circuits to allow', () => {
  const root = sandbox();
  try {
    writeSince(root, 600);
    const r = evaluateBashInput({ command: '' }, { projectRoot: root });
    assert.notEqual(r.decision, 'deny', 'empty cmd is no-op, not blocked by escalation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('escalation runs before reader/landed guards so a stale streak blocks even safe-looking commands', () => {
  const root = sandbox();
  try {
    writeSince(root, 600);
    const r = evaluateBashInput({ command: 'ls -la' }, { projectRoot: root });
    assert.equal(r.decision, 'deny');
    assert.match(r.reason, /LIFESAVER ESCALATION/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
