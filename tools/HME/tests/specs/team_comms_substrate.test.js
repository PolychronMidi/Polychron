'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ASK_PEER = path.join(PROJECT_ROOT, 'tools/HME/scripts/ask-peer.sh');
const DISPATCH = path.join(PROJECT_ROOT, 'tools/HME/scripts/team_dispatch_guard.py');

function tmpProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-team-comms-'));
  fs.mkdirSync(path.join(root, 'teams'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tmp'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tools/HME/runtime'), { recursive: true });
  return root;
}

function writeRoles(root, roles) {
  fs.mkdirSync(path.join(root, 'teams'), { recursive: true });
  fs.writeFileSync(path.join(root, 'teams/roles.json'), JSON.stringify({ roles }, null, 2));
}

function writeDashboard(root, agents) {
  const dir = path.join(root, 'tools/HME/runtime');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'team-dashboard.json'), JSON.stringify({ agents }));
}

function runAsk(root, args, env = {}) {
  return spawnSync(ASK_PEER, args, {
    cwd: root,
    env: { ...process.env, HME_ASK_PEER_PROJECT_ROOT: root, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

function runDispatch(root, args, env = {}) {
  return spawnSync('python3', [DISPATCH, ...args], {
    cwd: root,
    env: { ...process.env, PROJECT_ROOT: root, ...env },
    encoding: 'utf8',
    timeout: 10_000,
  });
}

const LEAD_ROLE = {
  channel: 'teams/driver.md',
  session_file: 'tmp/.team-blue_lead.session',
  tier: 'E5',
  effort: 'high',
  max_reply_bytes: 12000,
};

const CREW_ROLE = {
  channel: 'teams/driver.md',
  session_file: 'tmp/.team-crew_e3_0.session',
  tier: 'E3',
};

const BASE_AGENTS = {
  driver: { status: 'registered', tier: 'E5', ctx_used_pct: 5 },
  blue_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 10 },
  red_lead: { status: 'retired', tier: 'E5', ctx_used_pct: 20 },
  crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 30 },
};

test('ask-peer looks up registry, mints/resumes session, appends channel, and tail-caps', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { blue_lead: LEAD_ROLE });
    let r = runAsk(root, ['blue_lead', 'hello'], { HME_ASK_PEER_FAKE_REPLY: 'reply one', HME_TEAM_CHANNEL_TAIL_LINES: '3' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, 'reply one\n');
    const sidPath = path.join(root, 'tmp/.team-blue_lead.session');
    const sid1 = fs.readFileSync(sidPath, 'utf8').trim();
    assert.match(sid1, /^[0-9a-f-]{36}$/);
    let channel = fs.readFileSync(path.join(root, 'teams/driver.md'), 'utf8');
    assert.match(channel, /<driver role="blue_lead" tier="E5">"hello"<\/driver>/);
    assert.match(channel, /<peer role="blue_lead" tier="E5">"reply one"<\/peer>/);

    r = runAsk(root, ['blue_lead', 'again'], { HME_ASK_PEER_FAKE_REPLY: 'reply two', HME_TEAM_CHANNEL_TAIL_LINES: '3' });
    assert.equal(r.status, 0, r.stderr);
    const sid2 = fs.readFileSync(sidPath, 'utf8').trim();
    assert.equal(sid2, sid1, 'existing session id is reused');
    channel = fs.readFileSync(path.join(root, 'teams/driver.md'), 'utf8').trim();
    const lines = channel.split('\n');
    assert.equal(lines.length, 3, 'channel is tail-capped');
    assert.match(channel, /reply two/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ask-peer rejects roles outside bounded team channel and session paths', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { bad: { channel: 'chat.md', session_file: 'tmp/.team-bad.session', tier: 'E5' } });
    const r = runAsk(root, ['bad', 'hello'], { HME_ASK_PEER_FAKE_REPLY: 'nope' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid channel/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ask-peer blocks non-driver direct peer dispatch unless guard marked it', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { crew_e3_0: CREW_ROLE });
    const blocked = runAsk(root, ['crew_e3_0', 'hello'], {
      HME_TEAM_ROLE: 'blue_lead', HME_ASK_PEER_FAKE_REPLY: 'nope',
    });
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /use team_dispatch_guard\.py/);
    const allowed = runAsk(root, ['crew_e3_0', 'hello'], {
      HME_TEAM_ROLE: 'blue_lead', HME_TEAM_DISPATCH_GUARD_OK: '1', HME_ASK_PEER_FAKE_REPLY: 'ok',
    });
    assert.equal(allowed.status, 0, allowed.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dispatch guard blocks depth cap, per-turn budget, and E1-E2 crew spawning', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { blue_lead: LEAD_ROLE, crew_e3_0: CREW_ROLE });
    writeDashboard(root, BASE_AGENTS);
    const common = ['--caller', 'driver', '--tier', 'E5', '--scope', 'review', '--artifact', 'plan.md', '--max-duration', '30', '--max-tools', '2'];

    let r = runDispatch(root, [...common, '--depth', '2']);
    assert.equal(r.status, 0, r.stderr);
    let out = JSON.parse(r.stdout);
    assert.equal(out.allowed, false);
    assert.equal(out.code, 'spawn_depth');

    r = runDispatch(root, [...common, '--turn-id', 't1', '--budget', '1']);
    assert.equal(r.status, 0, r.stderr);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.target, 'blue_lead');
    assert.equal(out.budget.turn_id, 't1');
    assert.equal(out.budget.implicit, false);
    r = runDispatch(root, [...common, '--turn-id', 't1', '--budget', '1']);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, false);
    assert.equal(out.code, 'budget');

    r = runDispatch(root, ['--caller', 'blue_lead', '--tier', 'E3', '--scope', 'x', '--artifact', 'y', '--max-duration', '30', '--max-tools', '1'], { HME_TEAM_DEPTH: '2' });
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, false);
    assert.equal(out.code, 'spawn_depth', 'peer-propagated depth must block cascades');

    r = runDispatch(root, ['--caller', 'crew_e1_0', '--tier', 'E1', '--scope', 'x', '--artifact', 'y', '--max-duration', '30', '--max-tools', '1']);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, false);
    assert.equal(out.code, 'crew_spawn');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dispatch guard can explicitly send through ask-peer with leash text', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { blue_lead: LEAD_ROLE });
    writeDashboard(root, BASE_AGENTS);
    const r = runDispatch(root, [
      '--caller', 'driver', '--tier', 'E5', '--scope', 'bounded review', '--artifact', 'plan.md',
      '--max-duration', '30', '--max-tools', '2', '--send', '--message', 'check it',
    ], { HME_ASK_PEER_FAKE_REPLY: 'ok' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.sent, true);
    assert.equal(out.reply, 'ok');
    assert.equal(out.depth.next, 1);
    assert.equal(out.budget.implicit, true);
    assert.match(out.budget.turn_id, /^driver:/);
    const channel = fs.readFileSync(path.join(root, 'teams/driver.md'), 'utf8');
    assert.match(channel, /Leashed peer handoff for blue_lead/);
    assert.match(channel, /max_tools: 2/);
    assert.match(channel, /dispatch_depth: 1 \/ 2/);
    assert.match(channel, /turn_budget_id:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
