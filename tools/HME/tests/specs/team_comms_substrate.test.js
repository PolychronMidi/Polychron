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

const RED_LEAD_ROLE = {
  channel: 'teams/driver.md',
  session_file: 'tmp/.team-red_lead.session',
  tier: 'E5',
  effort: 'high',
  max_reply_bytes: 12000,
};

const BLUE_PURPLE_ROLE = {
  channel: 'teams/driver.md',
  channel_by_caller: { blue_lead: 'teams/blue.md', red_purple: 'teams/purple.md' },
  session_file: 'tmp/.team-blue_purple.session',
  tier: 'E4',
  effort: 'medium',
  max_reply_bytes: 10000,
};

const RED_PURPLE_ROLE = {
  channel: 'teams/driver.md',
  channel_by_caller: { red_lead: 'teams/red.md', blue_purple: 'teams/purple.md' },
  session_file: 'tmp/.team-red_purple.session',
  tier: 'E4',
  effort: 'medium',
  max_reply_bytes: 10000,
};

const CREW_ROLE = {
  channel: 'teams/driver.md',
  channel_by_caller: { red_lead: 'teams/red.md', red_purple: 'teams/red.md', blue_lead: 'teams/blue.md', blue_purple: 'teams/blue.md' },
  session_file: 'tmp/.team-crew_e3_0.session',
  tier: 'E3',
  effort: 'medium',
  max_reply_bytes: 8000,
};

const CREW_ROLE_1 = {
  ...CREW_ROLE,
  session_file: 'tmp/.team-crew_e3_1.session',
};

function meshRoles() {
  return {
    blue_lead: LEAD_ROLE,
    red_lead: RED_LEAD_ROLE,
    blue_purple: BLUE_PURPLE_ROLE,
    red_purple: RED_PURPLE_ROLE,
    crew_e3_0: CREW_ROLE,
    crew_e3_1: CREW_ROLE_1,
  };
}

const BAD_EFFORT_ROLE = {
  channel: 'teams/driver.md',
  session_file: 'tmp/.team-blue_lead.session',
  tier: 'E5',
  effort: 'max-plus',
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

test('ask-peer rejects roles outside bounded paths, effort ceiling, and model-tier sync', () => {
  const root = tmpProject();
  try {
    writeRoles(root, { bad: { channel: 'chat.md', session_file: 'tmp/.team-bad.session', tier: 'E5' } });
    let r = runAsk(root, ['bad', 'hello'], { HME_ASK_PEER_FAKE_REPLY: 'nope' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid channel/);

    writeRoles(root, { blue_lead: BAD_EFFORT_ROLE });
    r = runAsk(root, ['blue_lead', 'hello'], { HME_ASK_PEER_FAKE_REPLY: 'nope' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /invalid effort/);

    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config/models.json'), JSON.stringify({ team_role_models: { team_lead: { tier: 'E4' } } }));
    writeRoles(root, { blue_lead: LEAD_ROLE });
    r = runAsk(root, ['blue_lead', 'hello'], { HME_ASK_PEER_FAKE_REPLY: 'nope' });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /tier drift/);
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
    assert.ok(fs.existsSync(path.join(root, 'tmp/.team-channel-teams_driver.md.lock')));
    const channel = fs.readFileSync(path.join(root, 'teams/driver.md'), 'utf8');
    assert.match(channel, /Leashed peer handoff for blue_lead/);
    assert.match(channel, /max_tools: 2/);
    assert.match(channel, /dispatch_depth: 1 \/ 2/);
    assert.match(channel, /turn_budget_id:/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('I3 roles route to red, blue, and purple channels without broadcast', () => {
  const root = tmpProject();
  try {
    writeRoles(root, meshRoles());
    let r = runAsk(root, ['red_purple', 'red intra'], {
      HME_TEAM_ROLE: 'red_lead', HME_TEAM_DISPATCH_GUARD_OK: '1', HME_ASK_PEER_FAKE_REPLY: 'red ok',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(root, 'teams/red.md'), 'utf8'), /red intra/);

    r = runAsk(root, ['blue_purple', 'blue intra'], {
      HME_TEAM_ROLE: 'blue_lead', HME_TEAM_DISPATCH_GUARD_OK: '1', HME_ASK_PEER_FAKE_REPLY: 'blue ok',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(root, 'teams/blue.md'), 'utf8'), /blue intra/);

    r = runAsk(root, ['blue_purple', 'purple cross'], {
      HME_TEAM_ROLE: 'red_purple', HME_TEAM_DISPATCH_GUARD_OK: '1', HME_ASK_PEER_FAKE_REPLY: 'purple ok',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(path.join(root, 'teams/purple.md'), 'utf8'), /purple cross/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('I3 dispatch guard selects real roles and writes caller-specific channels', () => {
  const root = tmpProject();
  try {
    writeRoles(root, meshRoles());
    writeDashboard(root, {
      driver: { status: 'registered', tier: 'E5', ctx_used_pct: 5 },
      blue_lead: { status: 'retired', tier: 'E5', ctx_used_pct: 1 },
      red_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 10 },
      red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 20 },
      blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 30 },
      crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 40 },
    });

    let r = runDispatch(root, [
      '--caller', 'driver', '--tier', 'E5', '--turn-id', 'i3-driver', '--budget', '4',
      '--scope', 'red lead bootstrap', '--artifact', 'teams/driver.md', '--max-duration', '30', '--max-tools', '2',
    ]);
    assert.equal(r.status, 0, r.stderr);
    let out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.target, 'red_lead');

    r = runDispatch(root, [
      '--caller', 'red_lead', '--tier', 'E4', '--turn-id', 'i3-red', '--budget', '4',
      '--scope', 'red purple review', '--artifact', 'teams/red.md', '--max-duration', '30', '--max-tools', '2',
      '--send', '--message', 'challenge this red plan',
    ], { HME_ASK_PEER_FAKE_REPLY: 'red purple ok' });
    assert.equal(r.status, 0, r.stderr);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.target, 'red_purple');
    assert.equal(out.sent, true);
    assert.match(fs.readFileSync(path.join(root, 'teams/red.md'), 'utf8'), /challenge this red plan/);

    r = runDispatch(root, [
      '--caller', 'red_purple', '--tier', 'E4', '--turn-id', 'i3-red', '--budget', '4',
      '--scope', 'purple opposition', '--artifact', 'teams/purple.md', '--max-duration', '30', '--max-tools', '2',
      '--send', '--message', 'oppose this from blue purple',
    ], { HME_ASK_PEER_FAKE_REPLY: 'blue purple ok' });
    assert.equal(r.status, 0, r.stderr);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.target, 'blue_purple');
    assert.equal(out.sent, true);
    assert.match(fs.readFileSync(path.join(root, 'teams/purple.md'), 'utf8'), /oppose this from blue purple/);

    r = runDispatch(root, [
      '--caller', 'red_lead', '--tier', 'E3', '--turn-id', 'i3-crew', '--budget', '4',
      '--scope', 'red crew check', '--artifact', 'teams/red.md', '--max-duration', '30', '--max-tools', '2',
    ]);
    assert.equal(r.status, 0, r.stderr);
    out = JSON.parse(r.stdout);
    assert.equal(out.allowed, true);
    assert.equal(out.target, 'crew_e3_0');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
