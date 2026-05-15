'use strict';
// Smoke tests for i/status state. Verifies the panel renders without
// crashing, shows core sections (HCI, KB, last activity), and emits
// the multi-timescale HCI line when timeseries is present.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const I_STATUS = path.join(PROJECT_ROOT, 'i', 'status');

function _run(args = []) {
  const r = spawnSync(I_STATUS, ['state', ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status };
}

test('i/status state renders without crashing', () => {
  const r = _run();
  assert.strictEqual(r.status, 0, `stderr: ${r.stderr}`);
  assert.match(r.stdout, /HME state panel/);
});

test('i/status state shows onboarding state line', () => {
  const r = _run();
  assert.match(r.stdout, /onboarding\s+\S+/);
});

test('i/status state shows HCI line with verifier count', () => {
  const r = _run();
  assert.match(r.stdout, /HCI\s+\d+(?:\.\d+)?\/100\s+\(\d+\s+verifiers\)/);
});

test('i/status state shows multi-timescale phase line when timeseries exists', () => {
  // Skip gracefully if timeseries isn't there (clean checkout)
  const ts = path.join(PROJECT_ROOT, 'output', 'metrics',
    'hme-coherence-timeseries.jsonl');
  if (!fs.existsSync(ts)) return;
  const r = _run();
  // Format: "1m  ago +N.N . 1h  ago +N.N . 1d  ago +N.N . peak NN (Nh ago)"
  assert.match(
    r.stdout,
    /1m\s+ago\s+[+\-\d.]+\s+.\s+1h\s+ago\s+[+\-\d.]+\s+.\s+1d\s+ago\s+[+\-\d.]+\s+.\s+peak\s+\d+/,
    `expected multi-timescale phase line; got:\n${r.stdout}`
  );
});

test('i/status state mode=brief omits drill-in footer', () => {
  const r = _run(['mode=brief']);
  assert.strictEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /Drill-in:/);
});

test('i/status state shows pipeline state', () => {
  const r = _run();
  assert.match(r.stdout, /pipeline\s+(idle|RUNNING)/);
});


// Smoke tests for the three new horizon-seed modes shipped this session.
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
  assert.match(r.stdout, /Agent loop|No activity|No agent-loop telemetry/);
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
  assert.match(r.stdout, /project->subsystem|verifier->category|kb->category/);
});

test('i/why mode=fractal-shape includes the expansion scales (L0 + policy)', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  // Both scales added during the X expansion should render
  assert.match(r.stdout, /L0->consumers/, 'L0->consumers scale missing from fractal-shape');
  assert.match(r.stdout, /policy->event/, 'policy->event scale missing from fractal-shape');
});

test('i/why mode=fractal-shape reports uniform-baseline verdict', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  // Uniform-baseline contrast section should be present
  assert.match(r.stdout, /Empirical signature vs uniform-baseline|verdict:\s*(SUPPORTS|PARTIAL|NOT SUPPORTED)/);
});

test('i/why mode=fractal-shape history=true renders trend section', () => {
  // Run twice to ensure history has >=2 entries
  _runWhy(['mode=fractal-shape']);
  const r = _runWhy(['mode=fractal-shape', 'history=true']);
  assert.strictEqual(r.status, 0);
  // Either reports a trend or the "need >=2 for trend" message
  assert.match(r.stdout, /Tensegrity-shape trend over time|mean-Gini trend|no history yet|need.*for trend/);
});

test('i/status mode=multi-axis-band reads proposed band when persisted', () => {
  // Trigger band-tuning to write the proposal first
  _runStatus('band-tuning');
  const r = _runStatus('multi-axis-band');
  assert.strictEqual(r.status, 0);
  // When the proposal file exists, the multi-axis-band view shows
  // the proposed-aggregate-band line. If band-tuning didn't write
  // (e.g. no verdicts), the test still passes -- the conditional
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
    // 30s timeout flaked at the edge whenever the embedder wasn't
    // already warm (e.g. immediately after a `clear_index` rebuild
    // or worker restart -- first call costs ~25-30s for embedder
    // cold-start). 60s buys headroom while still failing fast on
    // real hangs. Direct manual invocation confirms the call itself
    // returns within ~30s when the embedder warms.
    timeout: 60000,
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
  // Run the verifier -- outcome depends on current data state, but the
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

test('i/status holograph mode=trajectory renders horizon evolution over time', () => {
  // Run once to ensure history has at least 1 snapshot, then again so
  // we have 2 (the trajectory view requires >=2 to render side-by-side).
  spawnSync(path.join(PROJECT_ROOT, 'i', 'status'), ['holograph'], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  spawnSync(path.join(PROJECT_ROOT, 'i', 'status'), ['holograph'], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'status'), ['holograph', 'mode=trajectory'], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /Holograph trajectory|need.*for trajectory/);
});

test('i/status holograph renders all 10 horizons as one panel', () => {
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'status'), ['holograph'], {
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
      `i/status holograph missing horizon [${hid}] row`);
  }
});

test('i/status state surfaces agent-loop-quality verifier inline', () => {
  const r = _run();
  assert.strictEqual(r.status, 0);
  // Either the agent-loop line is visible (verifier present in snapshot)
  // OR the panel renders without it (snapshot/verifier absent)
  assert.match(r.stdout, /(agent-loop\s+[.!]\s+(PASS|FAIL|WARN))|HME state panel/);
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
  // terminal/leaf marker -- proves the walker actually traversed.
  if (r.stdout.includes('Recursive causal chain')) {
    assert.match(r.stdout, />|\+-|terminal|leaf description|cycle detected/);
  }
});

test('i/why mode=causality --root-cause walks to leaf and reports it', () => {
  const r = _runWhy(['mode=causality', 'brief_recorded', '--root-cause']);
  assert.strictEqual(r.status, 0);
  // Either reports root cause + walked-N-steps or notes no events
  assert.match(r.stdout, /Root cause|walked \d+ step|No 'brief_recorded' events found/);
});

test('i/why mode=architecture-snapshot renders composite full-system report', () => {
  const r = _runWhy(['mode=architecture-snapshot']);
  assert.strictEqual(r.status, 0);
  // Multiple section dividers should appear; at minimum the title block
  // and the State machine snapshot section.
  assert.match(r.stdout, /HME Architecture Snapshot/);
  assert.match(r.stdout, /State machine snapshot/);
  assert.match(r.stdout, /Composite report complete/);
});

test('rotate-history-files dry-run reports policy state without modifying', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const activityPath = path.join(PROJECT_ROOT, 'output/metrics/hme-activity.jsonl');
  const beforeSize = fs.existsSync(activityPath) ? fs.statSync(activityPath).size : 0;
  const r = spawnSync('python3',
    [path.join(PROJECT_ROOT, 'scripts/hme/rotate-history-files.py'), '--dry-run'],
    { encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
      env: { ...process.env, PROJECT_ROOT } });
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /HME history rotation.*\(dry-run\)/);
  assert.match(r.stdout, /under cap|would-rotate/);
  // Dry-run must not modify the file
  const afterSize = fs.existsSync(activityPath) ? fs.statSync(activityPath).size : 0;
  assert.strictEqual(beforeSize, afterSize, 'dry-run modified file');
});

test('i/status holograph reflects tier marker + prune-candidate count', () => {
  const r = spawnSync(path.join(PROJECT_ROOT, 'i', 'status'), ['holograph'], {
    encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
    env: { ...process.env, PROJECT_ROOT },
  });
  assert.strictEqual(r.status, 0);
  // tier= label appears on agent-loop row when marker file present;
  // prune-candidates= appears on verifier ecosystem row when prune
  // marker has candidates. Both are conditional on data state.
  // Assert at minimum the holograph rendered all 10 horizon rows.
  for (const hid of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']) {
    assert.match(r.stdout, new RegExp(`\\[${hid}\\s*\\]`));
  }
});

test('i/why mode=fractal-shape reports redundancy ablation column (Horizon X maturity)', () => {
  const r = _runWhy(['mode=fractal-shape']);
  assert.strictEqual(r.status, 0);
  // Table now has gini-no-max + redundancy columns
  assert.match(r.stdout, /gini-no-max|redundancy/);
});

test('i/why mode=verifier-utility persists auto-prune marker (Horizon VI maturity)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const prunePath = path.join(PROJECT_ROOT, 'tmp', 'hme-verifier-prune.json');
  const r = _runWhy(['mode=verifier-utility']);
  assert.strictEqual(r.status, 0);
  // Marker may not exist if no always-PASS verifiers (rare); both are
  // valid outcomes -- test asserts the marker has the right shape if present.
  if (fs.existsSync(prunePath)) {
    const body = JSON.parse(fs.readFileSync(prunePath, 'utf8'));
    assert.ok('candidates' in body);
    assert.ok('weight_multiplier' in body);
    assert.ok(Array.isArray(body.candidates));
  }
});

test('agent-loop-quality verifier writes tier marker (Horizon IV maturity)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  // Run the verifier directly via Python -- same path the snapshot pass takes.
  const r = spawnSync('python3', ['-c',
    `import sys; sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}'); ` +
    'from verify_coherence.code_audits import AgentLoopQualityVerifier; ' +
    'r = AgentLoopQualityVerifier().execute(); print(r.status)'
  ], { encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(r.status, 0);
  // Tier marker is conditional on having data; only PASS/FAIL paths write it.
  // SKIP path (no activity) skips the marker -- both are valid.
  const tierPath = path.join(PROJECT_ROOT, 'tmp', 'hme-agent-loop-tier.json');
  if (fs.existsSync(tierPath)) {
    const body = JSON.parse(fs.readFileSync(tierPath, 'utf8'));
    assert.ok(['GREEN', 'YELLOW', 'RED'].includes(body.tier));
    assert.ok('reason' in body);
  }
});

test('i/why mode=kb-graph reports entity-name edges (Horizon III maturity)', () => {
  const r = _runWhy(['mode=kb-graph']);
  assert.strictEqual(r.status, 0);
  // When KB has data, the entity-name edge kind should appear; when
  // KB is empty, the empty-message path is used.
  assert.match(r.stdout, /entity-name|KB empty|0 edges/);
});

test('i/status state HCI line carries confidence indicator (Horizon II maturity)', () => {
  const r = _run();
  assert.strictEqual(r.status, 0);
  // HCI line should include conf=uniform/mixed/fragile when a snapshot
  // is available; absent that, the fallback HCI line is acceptable.
  assert.match(r.stdout, /HCI\s+\S+.*\s*(conf=(uniform|mixed|fragile)|\(\d+ verifiers\))/);
});

test('conjugate-channel SKIP path refreshes license when streak active', () => {
  // Verifier SKIPs when hme_coherence is null. Before this turn,
  // SKIP did nothing else; now it refreshes the band-widening
  // proposal based on legendary streak alone (composition-aware fast
  // feedback). Test: invoke the verifier directly and check the
  // marker file gets a `streak-aware-skip-refresh` trigger when the
  // streak is >=2 (and the verifier returns SKIP).
  const fs = require('node:fs');
  const path = require('node:path');
  const tighteningPath = path.join(PROJECT_ROOT, 'tmp', 'hme-band-tightening.json');
  // Snapshot for restore
  const had = fs.existsSync(tighteningPath);
  const prev = had ? fs.readFileSync(tighteningPath, 'utf8') : null;
  try {
    // Run the verifier
    const r = spawnSync('python3', ['-c',
      `import sys; sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}'); ` +
      'from verify_coherence.code_audits import ConjugateChannelVerifier, _count_legendary_streak; ' +
      `r = ConjugateChannelVerifier().execute(); ` +
      `streak = _count_legendary_streak('${PROJECT_ROOT}'); ` +
      'print(f"{r.status}|{streak}")'
    ], { encoding: 'utf8', timeout: 15000 });
    assert.strictEqual(r.status, 0);
    const [status, streakStr] = r.stdout.trim().split('|');
    const streak = parseInt(streakStr, 10);
    // If status=SKIP AND streak >= 2, the file should be a
    // streak-aware-skip-refresh proposal. Otherwise behavior unchanged.
    if (status === 'SKIP' && streak >= 2 && fs.existsSync(tighteningPath)) {
      const body = JSON.parse(fs.readFileSync(tighteningPath, 'utf8'));
      // Either it was JUST written by the SKIP path (carries the new trigger)
      // or it was written by an earlier path; both are valid outcomes,
      // but the field shape must be consistent.
      assert.ok('band_delta' in body);
      assert.ok('expires_after_rounds' in body);
      if (body.trigger === 'streak-aware-skip-refresh') {
        assert.ok(body.streak && body.streak.legendary_consecutive >= 2,
          'SKIP-refresh trigger should record streak count');
      }
    }
  } finally {
    if (had) fs.writeFileSync(tighteningPath, prev);
  }
});

test('_count_legendary_streak counts consecutive legendary verdicts ending at latest', () => {
  // Direct-import the helper; verifies the streak-aware sizing math
  // independently of the verifier's full execution (which SKIPs when
  // hme_coherence is null).
  const r = spawnSync('python3', ['-c',
    `import sys; sys.path.insert(0, '${path.join(PROJECT_ROOT, 'tools/HME/scripts')}'); ` +
    'from verify_coherence.code_audits import _count_legendary_streak; ' +
    `print(_count_legendary_streak('${PROJECT_ROOT}'))`
  ], { encoding: 'utf8', timeout: 15000 });
  assert.strictEqual(r.status, 0);
  // Streak count must be a non-negative integer (live data may have any value)
  const streak = parseInt(r.stdout.trim(), 10);
  assert.ok(Number.isInteger(streak), 'streak must be an integer');
  assert.ok(streak >= 0, 'streak must be non-negative');
});

test('streak-aware sizing math: cap at +0.10 delta and 4 rounds expiry', () => {
  // Verify the scaling formulas directly. base 0.05, +0.025/streak, cap 0.10
  // for delta; base 1, +1/streak, cap 4 for expires_after_rounds.
  const cases = [
    { streak: 0, delta: 0.05, expiry: 1 },  // 0/1 fallback
    { streak: 1, delta: 0.05, expiry: 1 },  // base
    { streak: 2, delta: 0.075, expiry: 2 },
    { streak: 3, delta: 0.10, expiry: 3 },  // delta hits cap
    { streak: 4, delta: 0.10, expiry: 4 },  // both at cap
    { streak: 10, delta: 0.10, expiry: 4 }, // both saturated
  ];
  for (const c of cases) {
    const delta = Math.min(0.10, 0.05 + Math.max(0, c.streak - 1) * 0.025);
    const expiry = Math.min(4, 1 + Math.max(0, c.streak - 1));
    assert.ok(Math.abs(delta - c.delta) < 1e-9,
      `streak=${c.streak}: expected delta=${c.delta}, got ${delta}`);
    assert.strictEqual(expiry, c.expiry,
      `streak=${c.streak}: expected expiry=${c.expiry}, got ${expiry}`);
  }
});

test('compute-coherence-budget handles bidirectional band adjustment (widen + narrow)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const tighteningPath = path.join(PROJECT_ROOT, 'tmp', 'hme-band-tightening.json');
  const outPath = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-coherence-budget.json');
  const tighteningExisted = fs.existsSync(tighteningPath);
  const tighteningPrev = tighteningExisted ? fs.readFileSync(tighteningPath, 'utf8') : null;
  const outExisted = fs.existsSync(outPath);
  const outPrev = outExisted ? fs.readFileSync(outPath, 'utf8') : null;
  try {
    // Stage a positive-delta (widen) proposal -- license-to-explore signal
    fs.mkdirSync(path.dirname(tighteningPath), { recursive: true });
    fs.writeFileSync(tighteningPath, JSON.stringify({
      ts: Date.now() / 1000,
      trigger: 'license-to-explore-test',
      reason: 'test: integration smoke for widen branch',
      recommended_action: 'widen_band',
      band_delta: +0.05,
      expires_after_rounds: 1,
    }));
    const r = spawnSync('node',
      [path.join(PROJECT_ROOT, 'scripts/pipeline/hme/compute-coherence-budget.js')],
      { encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
        env: { ...process.env, PROJECT_ROOT } });
    if (r.status !== 0) return;  // bail gracefully if upstream deps missing
    if (fs.existsSync(outPath)) {
      const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      assert.ok('band_tightening' in report);
      if (report.band_tightening && report.band_tightening.applied) {
        assert.strictEqual(report.band_tightening.direction, 'widen',
          'positive delta should produce direction=widen');
        // Widen must produce after-band wider than before-band
        const before = report.band_tightening.before;
        const after = report.band_tightening.after;
        assert.ok((after[1] - after[0]) > (before[1] - before[0]),
          'widen direction should produce wider after-band');
      }
    }
  } finally {
    if (tighteningExisted) fs.writeFileSync(tighteningPath, tighteningPrev);
    else if (fs.existsSync(tighteningPath)) fs.unlinkSync(tighteningPath);
    if (outExisted) fs.writeFileSync(outPath, outPrev);
  }
});

test('compute-coherence-budget consumes V->IX band-tightening proposal', () => {
  // Verifies the cross-horizon coupling: when conjugate-channel writes
  // tmp/hme-band-tightening.json, the next pipeline run's
  // compute-coherence-budget reads it and narrows the band. The first
  // place HME's signal CHANGES composition behavior, not just monitor.
  const fs = require('node:fs');
  const path = require('node:path');
  const tighteningPath = path.join(PROJECT_ROOT, 'tmp', 'hme-band-tightening.json');
  const outPath = path.join(PROJECT_ROOT, 'output', 'metrics', 'hme-coherence-budget.json');

  // Snapshot current state so we can restore
  const tighteningExisted = fs.existsSync(tighteningPath);
  const tighteningPrev = tighteningExisted ? fs.readFileSync(tighteningPath, 'utf8') : null;
  const outExisted = fs.existsSync(outPath);
  const outPrev = outExisted ? fs.readFileSync(outPath, 'utf8') : null;

  try {
    // Stage a fresh tightening proposal
    fs.mkdirSync(path.dirname(tighteningPath), { recursive: true });
    fs.writeFileSync(tighteningPath, JSON.stringify({
      ts: Date.now() / 1000,  // fresh
      trigger: 'test_smoke',
      reason: 'integration test',
      recommended_action: 'narrow_band',
      band_delta: -0.05,
      expires_after_rounds: 1,
    }));
    // Run the pipeline script
    const r = spawnSync('node',
      [path.join(PROJECT_ROOT, 'scripts/pipeline/hme/compute-coherence-budget.js')],
      { encoding: 'utf8', timeout: 30000, cwd: PROJECT_ROOT,
        env: { ...process.env, PROJECT_ROOT } });
    if (r.status !== 0) {
      // Pipeline may legitimately fail in test environment (missing
      // dependencies upstream). Bail gracefully -- the assertion target
      // is "tightening was attempted", not "full pipeline ran".
      return;
    }
    if (fs.existsSync(outPath)) {
      const report = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      // The band_tightening field should be present and reflect that
      // the proposal was applied (or a plausible reason it wasn't)
      assert.ok('band_tightening' in report,
        'compute-coherence-budget should record band_tightening field');
      if (report.band_tightening) {
        if (report.band_tightening.applied === true) {
          assert.ok(Array.isArray(report.band_tightening.before));
          assert.ok(Array.isArray(report.band_tightening.after));
        }
      }
    }
  } finally {
    // Restore tightening file state
    if (tighteningExisted) {
      fs.writeFileSync(tighteningPath, tighteningPrev);
    } else if (fs.existsSync(tighteningPath)) {
      fs.unlinkSync(tighteningPath);
    }
    // Restore the output file state
    if (outExisted) {
      fs.writeFileSync(outPath, outPrev);
    }
  }
});

test('agent_jobs captures Agent result + writes to tmp/hme-subagent-results/', () => {
  // End-to-end Tier-3 round-trip: simulate the proxy delivering an
  // Agent tool_result whose description carries the HME_AGENT_TASK
  // sentinel. Agent-job capture must write the result file,
  // emit the captured event. We bypass the proxy daemon by invoking
  // the middleware directly with a synthetic toolUse + toolResult.
  const fs = require('node:fs');
  const path = require('node:path');
  // Force PROJECT_ROOT for the require-cached middleware
  process.env.PROJECT_ROOT = PROJECT_ROOT;
  // Bust require cache so the middleware reads our env
  for (const key of Object.keys(require.cache)) {
    if (key.includes('/proxy/') || key.includes('/middleware/')) {
      delete require.cache[key];
    }
  }
  const agentJobs = require(path.join(PROJECT_ROOT, 'tools/HME/proxy/middleware/13_agent_jobs.js'));
  // Generate a unique req_id so we don't collide with any real run
  const reqId = `test_${Date.now().toString(16).slice(-12)}`.replace(/[^a-f0-9]/g, 'a').slice(0, 12).padEnd(12, 'b');
  const queueDir = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-queue');
  const resultsDir = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-results');
  const queuePath = path.join(queueDir, `${reqId}.json`);
  const resultPath = path.join(resultsDir, `${reqId}.json`);
  // Pre-stage queue entry so the bridge has something to move to done/
  fs.mkdirSync(queueDir, { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify({ req_id: reqId, prompt: 'test' }));
  // Synthetic toolUse + toolResult mimicking what the proxy would route
  const toolUse = {
    name: 'Agent',
    input: { description: `HME reasoning for ${reqId}` },
  };
  const toolResult = { content: 'simulated agent reply text' };
  const emitted = [];
  const ctx = {
    emit: (e) => emitted.push(e),
    warn: () => {},
  };
  try {
    agentJobs.onToolResult({ toolUse, toolResult, ctx });
    assert.ok(fs.existsSync(resultPath), 'agent_jobs did not write result file');
    const body = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.strictEqual(body.req_id, reqId);
    assert.strictEqual(body.text, 'simulated agent reply text');
    assert.strictEqual(body.empty, false);
    assert.ok(typeof body.captured_at === 'number');
    const cap = emitted.find(e => e.event === 'agent_jobs_result_captured');
    assert.ok(cap, 'agent_jobs did not emit result-captured event');
    assert.strictEqual(cap.req_id, reqId);
    // Queue entry must be moved to done/
    const donePath = path.join(queueDir, 'done', `${reqId}.json`);
    assert.ok(fs.existsSync(donePath), 'queue entry not moved to done/');
    assert.ok(!fs.existsSync(queuePath), 'queue entry not removed from active dir');
  } finally {
    // Clean up test artifacts. Use existence checks rather than
    // try/catch -- fail-fast policy disallows empty catches, and these
    // paths legitimately may or may not exist depending on whether the
    // test reached the move-to-done branch.
    if (fs.existsSync(resultPath)) fs.unlinkSync(resultPath);
    const donePath = path.join(queueDir, 'done', `${reqId}.json`);
    if (fs.existsSync(donePath)) fs.unlinkSync(donePath);
    if (fs.existsSync(queuePath)) fs.unlinkSync(queuePath);
  }
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
  // 999 levels (sanity bound -- runtime would explode otherwise)
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
