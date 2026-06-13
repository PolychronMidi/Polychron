'use strict';

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const ROUTER = path.join(PROJECT_ROOT, 'tools/HME/scripts/team_agent_router.py');

function runRouter(project, payload, role = 'driver') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-agent-router-input-'));
  const inputFile = path.join(dir, 'payload.json');
  fs.writeFileSync(inputFile, JSON.stringify(payload));
  const command = `PROJECT_ROOT=${JSON.stringify(project)} OVERDRIVE_MODE=1 HME_TEAM_ROLE=${JSON.stringify(role)} python3 ${JSON.stringify(ROUTER)} < ${JSON.stringify(inputFile)}`;
  const result = spawnSync('bash', ['-lc', command], {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 10_000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return result;
}

function projectWithDashboard(agents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-agent-router-'));
  const dir = path.join(root, 'tools/HME/runtime');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'team-dashboard.json'), JSON.stringify({ agents }));
  return root;
}

function hookOutput(result) {
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).hookSpecificOutput;
}

function routedTarget(result) {
  const out = hookOutput(result);
  assert.equal(out.permissionDecision, 'allow');
  assert.ok(out.updatedInput, `expected routed updatedInput, got ${JSON.stringify(out)}`);
  const m = out.updatedInput.description.match(/^([^ ]+) routed:/);
  assert.ok(m, `missing routed target in ${out.updatedInput.description}`);
  return m[1];
}

const AGENTS = {
  driver: { status: 'registered', tier: 'E5', ctx_used_pct: 5 },
  blue_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 10 },
  red_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 20 },
  blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 30 },
  red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 40 },
  crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 50 },
};

test('Agent level input routes to native Agent shape', () => {
  const root = projectWithDashboard(AGENTS);
  const r = runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.deepEqual(Object.keys(out.updatedInput), ['description', 'prompt', 'subagent_type']);
  assert.equal(out.updatedInput.subagent_type, 'general-purpose');
  assert.match(out.updatedInput.description, /^crew_e3_0 routed:/);
  assert.match(out.updatedInput.prompt, /You are crew_e3_0/);
  assert.match(out.updatedInput.prompt, /default forked subagent context/);
  assert.match(out.updatedInput.prompt, /do not spawn further Agent\/subagent tasks/);
  assert.match(out.updatedInput.prompt, /do not use multi_tool_use\.parallel for Agent/);
  assert.match(out.updatedInput.prompt, /Original task:\nhi/);
});

test('Agent rejects invalid level instead of falling back', () => {
  const root = projectWithDashboard(AGENTS);
  const r = runRouter(root, { tool_name: 'Agent', tool_input: { level: 9, prompt: 'hi' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /integer from 1 to 5/);
});

test('legacy subagent_type still routes invisibly through tier defaults', () => {
  const root = projectWithDashboard(AGENTS);
  const r = runRouter(root, { tool_name: 'Agent', tool_input: { subagent_type: 'Explore', prompt: 'map files' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.match(out.updatedInput.description, /^crew_e3_0 routed:/);
});

test('empty registry still applies HME default fork/bounds to raw Agent', () => {
  const root = projectWithDashboard({});
  const r = runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.match(out.additionalContext, /No registered HME crew/);
  assert.match(out.updatedInput.description, /^HME default-fork bounded:/);
  assert.match(out.updatedInput.prompt, /MODE=1 HME default-fork task/);
  assert.match(out.updatedInput.prompt, /default forked subagent context/);
});

test('non-empty registry with no matching tier applies default fork/bounds instead of native unbounded dispatch', () => {
  const root = projectWithDashboard({
    driver: { status: 'registered', tier: 'E5', ctx_used_pct: 5 },
  });
  const r = runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.match(out.additionalContext, /1 agent\(s\) registered, none match/);
  assert.match(out.additionalContext, /Applying default fork\/bounds/);
  assert.match(out.updatedInput.description, /^HME default-fork bounded:/);
  assert.match(out.updatedInput.prompt, /default forked subagent context/);
});

test('blocked E1/E2 crew stays blocked even with stray case/whitespace caller', () => {
  const root = projectWithDashboard(AGENTS);
  // caller normalization happens at resolve_target_for_tier (the chokepoint),
  // so a spoofed " Crew_E1_0 " must NOT escape the spawn block.
  const r = runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } }, ' Crew_E1_0 ');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /E1\/E2 stage crew may not spawn/);
});

test('uppercase/whitespace driver still routes to a team lead (no mis-route to crew)', () => {
  const root = projectWithDashboard(AGENTS);
  const r = runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } }, ' Driver ');
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout).hookSpecificOutput;
  assert.equal(out.permissionDecision, 'allow');
  assert.match(out.updatedInput.prompt, /You are (blue|red)_lead/);
});

test('malformed stdin is a deterministic passthrough (rc 0, no traceback)', () => {
  const root = projectWithDashboard(AGENTS);
  const command = `PROJECT_ROOT=${JSON.stringify(root)} OVERDRIVE_MODE=1 HME_TEAM_ROLE=driver python3 ${JSON.stringify(ROUTER)} <<< 'not json'`;
  const r = spawnSync('bash', ['-lc', command], { cwd: PROJECT_ROOT, env: { ...process.env }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
  assert.doesNotMatch(r.stderr, /Traceback/);
});

test('driver E5 uses least-context available team lead, then E4 fallback', () => {
  let root = projectWithDashboard({
    blue_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 60 },
    red_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 10 },
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 5 },
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 15 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } })), 'red_lead');

  root = projectWithDashboard({
    blue_lead: { status: 'retired', tier: 'E5', ctx_used_pct: 1 },
    red_lead: { status: 'registered', tier: 'E5', ctx_used_pct: 90 },
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 5 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } })), 'red_lead');

  root = projectWithDashboard({
    blue_lead: { status: 'retired', tier: 'E5', ctx_used_pct: 1 },
    red_lead: { status: 'failed', tier: 'E5', ctx_used_pct: 2 },
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 40 },
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 7 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } })), 'red_purple');
});

test('driver E4 uses least-context purple partner, then E4 stage crew without waiting', () => {
  let root = projectWithDashboard({
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 35 },
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 12 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 1 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 4, prompt: 'hi' } })), 'red_purple');

  root = projectWithDashboard({
    blue_purple: { status: 'done', tier: 'E4', ctx_used_pct: 1 },
    red_purple: { status: 'retired', tier: 'E4', ctx_used_pct: 2 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 20 },
    crew_e4_1: { status: 'registered', tier: 'E4', ctx_used_pct: 8 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 4, prompt: 'hi' } })), 'crew_e4_1');
});

test('driver E1-E3 routes to same-tier stage crew, falling lower by availability', () => {
  let root = projectWithDashboard({
    crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 70 },
    crew_e3_1: { status: 'registered', tier: 'E3', ctx_used_pct: 20 },
    crew_e2_0: { status: 'registered', tier: 'E2', ctx_used_pct: 1 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } })), 'crew_e3_1');

  root = projectWithDashboard({
    crew_e3_0: { status: 'failed', tier: 'E3', ctx_used_pct: 1 },
    crew_e3_1: { status: 'retired', tier: 'E3', ctx_used_pct: 2 },
    crew_e2_0: { status: 'registered', tier: 'E2', ctx_used_pct: 50 },
    crew_e2_1: { status: 'registered', tier: 'E2', ctx_used_pct: 5 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } })), 'crew_e2_1');
});

test('team lead E4/E5 routes to same-team purple, then E4 stage crew', () => {
  let root = projectWithDashboard({
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 80 },
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 1 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 2 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } }, 'blue_lead')), 'blue_purple');

  root = projectWithDashboard({
    blue_purple: { status: 'failed', tier: 'E4', ctx_used_pct: 1 },
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 2 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 9 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 4, prompt: 'hi' } }, 'blue_lead')), 'crew_e4_0');
});

test('team lead E1-E3 routes to appropriately tiered stage crew with lower fallback', () => {
  const root = projectWithDashboard({
    crew_e2_0: { status: 'retired', tier: 'E2', ctx_used_pct: 1 },
    crew_e1_0: { status: 'registered', tier: 'E1', ctx_used_pct: 9 },
    crew_e1_1: { status: 'registered', tier: 'E1', ctx_used_pct: 3 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 2, prompt: 'hi' } }, 'red_lead')), 'crew_e1_1');
});

test('purple E4/E5 routes to opposing purple, then E4 stage crew', () => {
  let root = projectWithDashboard({
    red_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 1 },
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 99 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 2 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } }, 'blue_purple')), 'red_purple');

  root = projectWithDashboard({
    red_purple: { status: 'failed', tier: 'E4', ctx_used_pct: 1 },
    blue_purple: { status: 'registered', tier: 'E4', ctx_used_pct: 2 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 10 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 4, prompt: 'hi' } }, 'blue_purple')), 'crew_e4_0');
});

test('purple E1-E3 routes to appropriately tiered stage crew with lower fallback', () => {
  const root = projectWithDashboard({
    crew_e3_0: { status: 'failed', tier: 'E3', ctx_used_pct: 1 },
    crew_e2_0: { status: 'registered', tier: 'E2', ctx_used_pct: 8 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } }, 'red_purple')), 'crew_e2_0');
});

test('E3/E4 stage crew may spawn only at or below their own tier', () => {
  let root = projectWithDashboard({
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 70 },
    crew_e4_1: { status: 'registered', tier: 'E4', ctx_used_pct: 2 },
    crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 1 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 5, prompt: 'hi' } }, 'crew_e4_0')), 'crew_e4_1');

  root = projectWithDashboard({
    crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 1 },
    crew_e3_1: { status: 'registered', tier: 'E3', ctx_used_pct: 9 },
    crew_e4_0: { status: 'registered', tier: 'E4', ctx_used_pct: 0 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 4, prompt: 'hi' } }, 'crew_e3_1')), 'crew_e3_0');
});

test('all E1/E2 stage crew role slots are blocked from spawning Agent', () => {
  const root = projectWithDashboard({
    crew_e2_7: { status: 'registered', tier: 'E2', ctx_used_pct: 1 },
    crew_e3_0: { status: 'registered', tier: 'E3', ctx_used_pct: 1 },
  });
  const out = hookOutput(runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } }, 'crew_e2_7'));
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /E1\/E2 stage crew may not spawn/);
});

test('mis-tagged stage crew dashboard tier is not routed as a valid match', () => {
  const root = projectWithDashboard({
    crew_e3_0: { status: 'registered', tier: 'E4', ctx_used_pct: 1 },
    crew_e2_0: { status: 'registered', tier: 'E2', ctx_used_pct: 5 },
  });
  assert.equal(routedTarget(runRouter(root, { tool_name: 'Agent', input: { level: 3, prompt: 'hi' } })), 'crew_e2_0');
});
