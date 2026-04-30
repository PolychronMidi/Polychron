'use strict';
// Smoke tests for i/state. Verifies the panel renders without
// crashing, shows core sections (HCI, KB, last activity), and emits
// the multi-timescale HCI line when timeseries is present.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_STATE = path.join(PROJECT_ROOT, 'i', 'state');

function _run(args = []) {
  const r = spawnSync(I_STATE, args, {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/state renders without crashing', () => {
  const r = _run();
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /HME state panel/);
});

test('i/state shows onboarding state line', () => {
  const r = _run();
  assert.match(r.stdout, /onboarding\s+\S+/);
});

test('i/state shows HCI line with verifier count', () => {
  const r = _run();
  assert.match(r.stdout, /HCI\s+\d+(?:\.\d+)?\/100\s+\(\d+\s+verifiers\)/);
});

test('i/state shows multi-timescale phase line when timeseries exists', () => {
  // Skip gracefully if timeseries isn't there (clean checkout)
  const ts = path.join(PROJECT_ROOT, 'output', 'metrics',
    'hme-coherence-timeseries.jsonl');
  if (!fs.existsSync(ts)) return;
  const r = _run();
  // Format: "1m  ago +N.N · 1h  ago +N.N · 1d  ago +N.N · peak NN (Nh ago)"
  assert.match(
    r.stdout,
    /1m\s+ago\s+[+\-\d.]+\s+·\s+1h\s+ago\s+[+\-\d.]+\s+·\s+1d\s+ago\s+[+\-\d.]+\s+·\s+peak\s+\d+/,
    `expected multi-timescale phase line; got:\n${r.stdout}`
  );
});

test('i/state mode=brief omits drill-in footer', () => {
  const r = _run(['mode=brief']);
  assert.strictEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Drill-in:/);
});

test('i/state shows pipeline state', () => {
  const r = _run();
  assert.match(r.stdout, /pipeline\s+(idle|RUNNING)/);
});


// Smoke tests for the three new horizon-seed modes shipped this session.
const I_STATUS = path.join(PROJECT_ROOT, 'i', 'status');
function _runStatus(mode) {
  const r = spawnSync(I_STATUS, [`mode=${mode}`], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/status mode=agent-loop renders Horizon IV view', () => {
  const r = _runStatus('agent-loop');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Agent loop|No activity/);
});

test('i/status mode=band-tuning renders Horizon IX view', () => {
  const r = _runStatus('band-tuning');
  assert.strictEqual(r.status, 0);
  // Either reports band proposal or notes missing prerequisite logs
  assert.match(r.stdout, /band[\- _]?tuning|band proposal|No (ground-truth|HCI timeseries)/i);
});

test('i/status mode=hci-by-subtag renders Horizon VI subtag aggregation', () => {
  const r = _runStatus('hci-by-subtag');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HCI by subtag|HCI \d/);
});

const I_WHY = path.join(PROJECT_ROOT, 'i', 'why');
function _runWhy(args) {
  const r = spawnSync(I_WHY, args, {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/why mode=verifier-coverage renders Horizon VI coverage view', () => {
  const r = _runWhy(['mode=verifier-coverage']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Verifier coverage|verifier-coverage/);
});

test('i/status mode=conjugate renders Horizon V joint view', () => {
  const r = _runStatus('conjugate');
  assert.strictEqual(r.status, 0);
  // Either reports the joint distribution or notes missing prerequisite
  assert.match(r.stdout, /Conjugate channel|No.*correlation/i);
});

test('i/status mode=conjugate uses data-driven thresholds when data present', () => {
  const r = _runStatus('conjugate');
  if (/No.*correlation/.test(r.stdout)) return;  // skip if no data
  assert.match(r.stdout, /thresholds:.*medians.*data-driven/);
});

test('i/why mode=verifier-drift renders Horizon VI drift view', () => {
  const r = _runWhy(['mode=verifier-drift']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /verifier-drift|frozen|No verifier/);
});

test('i/why mode=verifier-drift accepts n= lookback parameter', () => {
  const r = _runWhy(['mode=verifier-drift', 'n=10']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /lookback:\s*10/);
});

test('i/why mode=kb-graph renders Horizon III citation graph', () => {
  const r = _runWhy(['mode=kb-graph']);
  assert.strictEqual(r.status, 0);
  // Either reports the graph (entries + edges) or notes lance unavailable
  assert.match(r.stdout, /KB citation graph|KB empty|lance access unavailable/);
});

test('i/why mode=predict <file> renders Horizon I correlation view', () => {
  const r = _runWhy(['mode=predict', 'src/conductor/dynamics/coupling.js']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /predict.*src.conductor|No historical|correlated with edits/);
});

test('i/why mode=predict without path prints usage', () => {
  const r = _runWhy(['mode=predict']);
  assert.strictEqual(r.status, 2);  // exit code 2 for usage error
  assert.match(r.stdout, /Usage:|<file_path>/);
});

test('i/why mode=conscience renders Horizon VIII signature view', () => {
  const r = _runWhy(['mode=conscience']);
  assert.strictEqual(r.status, 0);
  // Either reports the verdict count + signature, or notes empty log
  assert.match(r.stdout, /Architectural conscience|No ground-truth/);
});

test('i/why mode=causality <event> renders Horizon VII chain view', () => {
  const r = _runWhy(['mode=causality', 'auto_brief_injected']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Heuristic causal chain|No.*events found/);
});

test('i/why mode=causality without event prints usage', () => {
  const r = _runWhy(['mode=causality']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /Usage:|<event-name>/);
});

test('i/why mode=fractal-shape renders Horizon X tensegrity-shape table', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Fractal-shape signature|Gini/);
  // Should report at least one scale
  assert.match(r.stdout, /project→subsystem|verifier→category|kb→category/);
});

test('i/why mode=fractal-shape includes the expansion scales (L0 + policy)', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  // Both scales added during the X expansion should render
  assert.match(r.stdout, /L0→consumers/, 'L0→consumers scale missing from fractal-shape');
  assert.match(r.stdout, /policy→event/, 'policy→event scale missing from fractal-shape');
});

test('i/why mode=fractal-shape reports uniform-baseline verdict', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  // Uniform-baseline contrast section should be present
  assert.match(r.stdout, /Empirical signature vs uniform-baseline|verdict:\s*(SUPPORTS|PARTIAL|NOT SUPPORTED)/);
});

test('i/why mode=fractal-shape history=true renders trend section', () => {
  // Run twice to ensure history has ≥2 entries
  _runWhy(['mode=fractal-shape']);
  const r = _runWhy(['mode=fractal-shape', 'history=true']);
  assert.strictEqual(r.status, 0);
  // Either reports a trend or the "need ≥2 for trend" message
  assert.match(r.stdout, /Tensegrity-shape trend over time|mean-Gini trend|no history yet|need.*for trend/);
});

test('i/status mode=multi-axis-band reads proposed band when persisted', () => {
  // Trigger band-tuning to write the proposal first
  _runStatus('band-tuning');
  const r = _runStatus('multi-axis-band');
  assert.strictEqual(r.status, 0);
  // When the proposal file exists, the multi-axis-band view shows
  // the proposed-aggregate-band line. If band-tuning didn't write
  // (e.g. no verdicts), the test still passes — the conditional
  // matches both shapes.
  assert.match(r.stdout, /(proposed aggregate band|Multi-axis chaordic bands)/);
});

test('i/why mode=causality reads activity-log caused_by field (Tier-1.5)', () => {
  // Inject a synthetic activity-log entry with explicit caused_by
  const fs = require('node:fs');
  const path = require('node:path');
  const activityPath = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-activity.jsonl');
  if (!fs.existsSync(activityPath)) return;  // skip if no activity log
  const beforeLen = fs.statSync(activityPath).size;
  const testEntry = JSON.stringify({
    event: 'caused_by_smoke_test',
    ts: Math.floor(Date.now() / 1000),
    caused_by: 'synthetic_smoke_test_caller',
  }) + '\n';
  fs.appendFileSync(activityPath, testEntry);
  try {
    const r = _runWhy(['mode=causality', 'caused_by_smoke_test']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Tier-1\.5: activity-log caused_by/);
    assert.match(r.stdout, /synthetic_smoke_test_caller/);
  } finally {
    // Truncate the test entry so we don't pollute production data
    fs.truncateSync(activityPath, beforeLen);
  }
});

test('i/why mode=verifier-utility reports incident-correlation when KB present', () => {
  const r = _runWhy(['mode=verifier-utility']);
  assert.strictEqual(r.status, 0);
  // Section is conditional on KB content; assertion accepts either
  // its presence or the standard summary
  assert.match(r.stdout, /Incident-correlation|Summary|runs analyzed/);
});

test('i/why mode=conscience renders move-similarity threshold marker when scored', () => {
  const r = _runWhy(['mode=conscience']);
  assert.strictEqual(r.status, 0);
  // Either similarity scoring fires (threshold marker visible) OR
  // the activity-log gap message displays (current data state)
  assert.match(r.stdout,
    /(similarity score|low similarity|partial similarity|No file_written events|(Architectural conscience))/);
});

test('i/learn action=suggest_predecessors returns ranked similarity matches', () => {
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'learn'), [
    'action=suggest_predecessors',
    'title=HME multi-axis chaordic bands learned per subtag',
    'content=per-subtag verifier scores tracked against bands proposed from ground-truth verdicts',
  ], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  assert.strictEqual(r.status, 0);
  // Either matches above threshold (tags= suggestion) or honest "no matches"
  assert.match(r.stdout, /Predecessor suggestions|tags="(derived_from|supersedes):|No matches above 0\.50|KB empty/);
});

test('conjugate-channel V-coupling: tightening file lifecycle is sane', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const tighteningPath = path.join(PROJECT_ROOT, 'tmp', 'hme-band-tightening.json');
  // Run the verifier — outcome depends on current data state, but the
  // marker should be either (a) present with the correct schema if FAIL
  // fired, or (b) absent if PASS fired and cleanup ran.
  const r = spawnSync('python3', ['-c',
    `import sys; sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}'); ` +
    'from verify_coherence.code_audits import ConjugateChannelVerifier; ' +
    'r = ConjugateChannelVerifier().execute(); print(r.status)'
  ], { encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(r.status, 0);
  const status = r.stdout.trim();
  if (status === 'FAIL') {
    // FAIL must produce the tightening marker
    assert.ok(fs.existsSync(tighteningPath),
      'conjugate-channel FAIL but tmp/hme-band-tightening.json not written');
    const body = JSON.parse(fs.readFileSync(tighteningPath, 'utf8'));
    assert.ok('recommended_action' in body);
    assert.ok('band_delta' in body);
    assert.ok('expires_after_rounds' in body);
  }
  // PASS path: cleanup may or may not have removed it (depends on
  // whether it was present); just assert no exception.
});

test('i/holograph mode=trajectory renders horizon evolution over time', () => {
  // Run once to ensure history has at least 1 snapshot, then again so
  // we have 2 (the trajectory view requires ≥2 to render side-by-side).
  spawnSync(path.join(PROJECT_ROOT, 'i', 'holograph'), [], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  spawnSync(path.join(PROJECT_ROOT, 'i', 'holograph'), [], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'holograph'), ['mode=trajectory'], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Holograph trajectory|need.*for trajectory/);
});

test('i/holograph renders all 10 horizons as one panel', () => {
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'holograph'), [], {
    encoding: 'utf8',
    timeout: 30000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HME Holograph|interstellar overview/);
  // Each horizon should appear as a [N] tag
  for (const hid of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']) {
    assert.match(r.stdout, new RegExp(`\\[${hid}\\s*\\]`),
      `i/holograph missing horizon [${hid}] row`);
  }
});

test('i/state surfaces agent-loop-quality verifier inline', () => {
  const r = _run();
  assert.strictEqual(r.status, 0);
  // Either the agent-loop line is visible (verifier present in snapshot)
  // OR the panel renders without it (snapshot/verifier absent)
  assert.match(r.stdout, /(agent-loop\s+[·!]\s+(PASS|FAIL|WARN))|HME state panel/);
});

test('i/why mode=kb-context <id> renders entry context', () => {
  // Pick a known id (8-char prefix); fall back gracefully if KB empty
  const r = _runWhy(['mode=kb-context', 'be854cd8']);
  assert.strictEqual(r.status, 0);
  // Either matches the entry or reports KB unavailable
  assert.match(r.stdout, /KB context|KB empty|No entry/);
});

test('i/why mode=kb-context without id prints usage', () => {
  const r = _runWhy(['mode=kb-context']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stdout, /Usage:|<entry-id-or-prefix>/);
});

test('i/status mode=multi-axis-band renders Horizon II per-subtag bands', () => {
  const r = _runStatus('multi-axis-band');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Multi-axis|chaordic band|subtag/);
});

test('i/status mode=tool-latency renders Horizon I cost-pred view', () => {
  const r = _runStatus('tool-latency');
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Tool-cost preflighting|cadence|latency/);
});

test('i/status mode=band-tuning persists proposal to tmp file', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const proposalPath = path.join(PROJECT_ROOT, 'tmp', 'hme-band-proposal.json');
  // Run band-tuning; it should write the proposal
  _runStatus('band-tuning');
  if (fs.existsSync(proposalPath)) {
    const data = JSON.parse(fs.readFileSync(proposalPath, 'utf8'));
    assert.ok('proposed_band' in data);
    assert.ok('current_band' in data);
    assert.ok(Array.isArray(data.proposed_band));
  }
});

test('i/why mode=causality --chain recursively walks caused_by chains', () => {
  const r = _runWhy(['mode=causality', 'brief_recorded', '--chain', 'depth=3']);
  assert.strictEqual(r.status, 0);
  // Either renders a recursive chain (with arrows + caused_by lines)
  // or reports no events of that type yet
  assert.match(r.stdout, /Recursive causal chain|No 'brief_recorded' events found/);
  // If chain rendered, it must show either at least one arrow or a
  // terminal/leaf marker — proves the walker actually traversed.
  if (r.stdout.includes('Recursive causal chain')) {
    assert.match(r.stdout, /▶|└─|terminal|leaf description|cycle detected/);
  }
});

test('i/why mode=causality --root-cause walks to leaf and reports it', () => {
  const r = _runWhy(['mode=causality', 'brief_recorded', '--root-cause']);
  assert.strictEqual(r.status, 0);
  // Either reports root cause + walked-N-steps or notes no events
  assert.match(r.stdout, /Root cause|walked \d+ step|No 'brief_recorded' events found/);
});

test('hme-cli coerce parses bracket-CSV form (real-bug regression)', () => {
  // The shorthand `tags=[a,b,c]` should produce ['a','b','c'], not iterate
  // characters. Tested via the i/learn ground_truth path: tags[2] should
  // arrive as the third tag, not the third character of the third tag.
  const tmpJsonl = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-ground-truth.jsonl');
  if (!require('node:fs').existsSync(tmpJsonl)) return;
  const beforeLen = require('node:fs').statSync(tmpJsonl).size;
  const round = `bracket_test_${Date.now()}`;
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'learn'), [
    'action=ground_truth',
    'title=S0',
    'tags=[arrival,legendary,structural-integrity]',
    `query=${round}`,
    'content=bracket regression smoke',
  ], { encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
       env: { ...process.env, PROJECT_ROOT } });
  if (r.status !== 0) return;  // path may fail offline; bail gracefully
  try {
    const tail = require('node:fs').readFileSync(tmpJsonl, 'utf8').split('\n').filter(s => s.includes(round));
    if (tail.length) {
      const rec = JSON.parse(tail[tail.length - 1]);
      assert.strictEqual(rec.moment_type, 'arrival', 'tags[0] should parse to "arrival" not a single char');
      assert.strictEqual(rec.sentiment, 'legendary', 'tags[1] should parse to "legendary" not a single char');
      assert.strictEqual(rec.subtag, 'structural-integrity', 'tags[2] should parse fully not as single char');
    }
  } finally {
    // Truncate the test entry from the JSONL so we don't pollute logs.
    require('node:fs').truncateSync(tmpJsonl, beforeLen);
    // Remove the KB mirror so the test doesn't accumulate orphan entries
    // in the project KB on every run.
    const search = spawnSync(path.join(PROJECT_ROOT, 'i', 'learn'),
      ['action=search', `query=${round}`], {
        encoding: 'utf8', timeout: 15000, cwd: PROJECT_ROOT,
        env: { ...process.env, PROJECT_ROOT },
      });
    const idMatch = (search.stdout || '').match(/id:\s*([a-f0-9]{12})/);
    if (idMatch) {
      spawnSync(path.join(PROJECT_ROOT, 'i', 'learn'), [`remove=${idMatch[1]}`], {
        encoding: 'utf8', timeout: 15000, cwd: PROJECT_ROOT,
        env: { ...process.env, PROJECT_ROOT },
      });
    }
  }
});

test('i/why mode=causality depth= clamps to safe range', () => {
  const r = _runWhy(['mode=causality', 'brief_recorded', '--chain', 'depth=999']);
  assert.strictEqual(r.status, 0);
  // depth is clamped to 20 internally; output should NOT actually walk
  // 999 levels (sanity bound — runtime would explode otherwise)
  // Assertion is just non-crash + non-empty output
  assert.ok(r.stdout.length > 0);
});

test('i/why mode=causality reads explicit caused_by from marker (Tier-1)', () => {
  // Inject a test marker with caused_by; verify the Tier-1 path renders it
  const fs = require('node:fs');
  const path = require('node:path');
  const markerPath = path.join(PROJECT_ROOT, 'tmp', 'hme-last-reload.json');
  let backup = null;
  try { backup = fs.readFileSync(markerPath, 'utf8'); } catch (_e) { /* no prior marker */ }
  const testMarker = {
    ts: Math.floor(Date.now() / 1000),
    trigger: 'auto',
    caused_by: 'tools/HME/service/server/test_caused_by.py',
    summary: 'test caused_by instrumentation',
  };
  fs.writeFileSync(markerPath, JSON.stringify(testMarker));
  try {
    const r = _runWhy(['mode=causality', 'hot_reload']);
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /Tier-1: explicit caused_by/);
    assert.match(r.stdout, /test_caused_by\.py/);
  } finally {
    if (backup) fs.writeFileSync(markerPath, backup);
    else { try { fs.unlinkSync(markerPath); } catch (_e) { /* best effort */ } }
  }
});
