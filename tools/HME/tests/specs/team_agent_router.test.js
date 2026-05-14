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
  return spawnSync('python3', [ROUTER], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT: project, OVERDRIVE_MODE: '6', HME_TEAM_ROLE: role },
    input: JSON.stringify(payload),
    encoding: 'utf8',
  });
}

function projectWithDashboard(agents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-agent-router-'));
  const dir = path.join(root, 'runtime/hme');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'team-dashboard.json'), JSON.stringify({ agents }));
  return root;
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
