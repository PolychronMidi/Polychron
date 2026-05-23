#!/usr/bin/env node
const { requireEnv: _hmeRequireEnv } = require('../proxy/shared/load_env.js');
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = _hmeRequireEnv('PROJECT_ROOT');
const HME_CLI = path.join(ROOT, 'tools', 'HME', 'scripts', 'hme-cli.js');
const REGISTRY = path.join(ROOT, 'tools', 'HME', 'i_registry.json');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: { ...process.env, PROJECT_ROOT: ROOT }, ...opts });
  process.exit(r.status === null ? 1 : r.status);
}

function stripSelector(args, mode, keys = ['mode', 'action']) {
  return args.filter((a) => !keys.some((k) => a === `${k}=${mode}`));
}

function keyValueToFlags(args) {
  const out = [];
  for (const a of args) {
    if (a.includes('=') && !a.startsWith('--')) {
      const idx = a.indexOf('=');
      out.push(`--${a.slice(0, idx).replaceAll('_', '-')}`, a.slice(idx + 1));
    } else {
      out.push(a);
    }
  }
  return out;
}

function selector(args, allowed) {
  if (args[0] && allowed.includes(args[0])) return { mode: args[0], rest: args.slice(1) };
  for (const a of args) {
    const m = /^(mode|action)=([^=]+)$/.exec(a);
    if (m && allowed.includes(m[2])) return { mode: m[2], rest: stripSelector(args, m[2]) };
  }
  return { mode: '', rest: args };
}

function hmeCli(tool, args) {
  if (!fs.existsSync(HME_CLI)) {
    console.error(`i/: tools/HME/scripts/hme-cli.js missing at ${HME_CLI} -- verify the checkout or regenerate i/ shims`);
    process.exit(1);
  }
  run('node', [HME_CLI, tool, ...args]);
}

function dispatchAudit(args) {
  const map = {
    tiered: ['python3', ['tools/HME/scripts/tiered_audit.py']],
    'audit-tiered': ['python3', ['tools/HME/scripts/tiered_audit.py']],
    blast: ['python3', ['tools/HME/scripts/blast_radius.py']],
    'blast-radius': ['python3', ['tools/HME/scripts/blast_radius.py']],
    parallel: ['python3', ['tools/HME/scripts/parallel_detect.py']],
    'parallel-detect': ['python3', ['tools/HME/scripts/parallel_detect.py']],
    sensitivity: ['node', ['src/scripts/metaprofile-sensitivity.js']],
    metaprofile: ['node', ['src/scripts/metaprofile-sensitivity.js']],
    prove: ['python3', ['tools/HME/scripts/prove.py']],
    tools: ['python3', ['tools/HME/scripts/audit-tool-surface.py']],
    'audit-tools': ['python3', ['tools/HME/scripts/audit-tool-surface.py']],
    surface: ['python3', ['tools/HME/scripts/audit-tool-surface.py']],
  };
  const { mode, rest } = selector(args, Object.keys(map));
  if (!mode) {
    console.log('i/audit modes: tiered, blast, parallel, sensitivity, prove, tools');
    process.exit(0);
  }
  const [bin, base] = map[mode];
  run(bin, [...base.map((p) => path.join(ROOT, p)), ...rest]);
}

function dispatchStatus(args) {
  const local = ['state', 'timeline', 'holograph', 'substrate', 'activity', 'team', 'project', 'project-detect', 'forks', 'fork-watchdog', 'decision-audit', 'freeze', 'pattern', 'patterns', 'codex-route', 'codex_proxy', 'codex-proxy'];
  const { mode, rest } = selector(args, local);
  if (!mode && args.length === 0) run('python3', [path.join(ROOT, 'tools/HME/scripts/substrate-view.py'), 'brief']);
  if (mode === 'activity') {
    run('bash', ['-lc', `
      set +e
      printf '== git ==\\n'
      git -C "$PROJECT_ROOT" status --porcelain=v1
      printf '\\n== load ==\\n'
      uptime
      printf '\\n== selected HME process counts ==\\n'
      pgrep -af '/tools/HME/(activity/universal_pulse.py|hooks/direct/universal-pulse-supervisor.sh|scripts/(snapshot-holograph|verify-coherence|verify-doc-sync|verify-numeric-drift|compact-lance-tables|analyze-hci-trajectory|detectors/test_detector_chain))|server.tools_analysis.todo import list_carried_over' | wc -l
      printf '\\n== top selected HME processes ==\\n'
      pgrep -af '/tools/HME/(activity/universal_pulse.py|hooks/direct/universal-pulse-supervisor.sh|scripts/(snapshot-holograph|verify-coherence|verify-doc-sync|verify-numeric-drift|compact-lance-tables|analyze-hci-trajectory|detectors/test_detector_chain))|server.tools_analysis.todo import list_carried_over' | sed -n '1,80p'
      printf '\\n== top cpu ==\\n'
      ps -eo pid,ppid,stat,pcpu,pmem,cmd --sort=-pcpu | head -25
    `]);
  }
  const r = rest.map((a) => a.startsWith('submode=') || a.startsWith('view=') ? `mode=${a.split('=').slice(1).join('=')}` : a === 'brief=true' ? 'mode=brief' : a === 'trajectory=true' ? 'mode=trajectory' : a.startsWith('pattern=') ? a.slice(8) : a);
  const py = {
    state: 'tools/HME/scripts/state-panel.py',
    timeline: 'tools/HME/scripts/timeline-panel.py',
    holograph: 'tools/HME/scripts/holograph-panel.py',
    substrate: 'tools/HME/scripts/substrate-view.py',
    team: 'tools/HME/scripts/team_dashboard.py',
    project: 'tools/HME/scripts/project_detect.py',
    'project-detect': 'tools/HME/scripts/project_detect.py',
    forks: 'tools/HME/scripts/fork_watchdog.py',
    'fork-watchdog': 'tools/HME/scripts/fork_watchdog.py',
    'decision-audit': 'tools/HME/scripts/decision_audit.py',
    freeze: 'tools/HME/scripts/freeze-check.py',
    pattern: 'tools/HME/scripts/pattern-registry.py',
  };
  if (mode === 'patterns') run('python3', [path.join(ROOT, 'tools/HME/scripts/substrate-view.py'), 'patterns', ...r]);
  if (mode === 'codex-route') hmeCli('status', ['mode=codex_route', ...r]);
  if (mode === 'codex_proxy' || mode === 'codex-proxy') hmeCli('status', ['mode=codex_proxy', ...r]);
  if (py[mode]) {
    const final = mode === 'team' ? keyValueToFlags(r) : r;
    run('python3', [path.join(ROOT, py[mode]), ...final]);
  }
  hmeCli('status', args);
}

function dispatchWhy(args) {
  spawnSync('python3', [path.join(ROOT, 'tools/HME/scripts/tool-usage-log.py'), 'why', ...args], {
    stdio: 'ignore',
    env: { ...process.env, PROJECT_ROOT: ROOT },
  });
  const modeMap = {
    block: 'why-block.py',
    state: 'why-state.py',
    verifier: 'why-verifier.py',
    'hci-drop': 'why-hci-drop.py',
    hook: 'why-hook.py',
    'verifier-utility': 'why-verifier-utility.py',
    'verifier-coverage': 'why-verifier-coverage.py',
    'verifier-drift': 'why-verifier-drift.py',
    'kb-graph': 'why-kb-graph.py',
    'kb-context': 'why-kb-context.py',
    predict: 'why-predict.py',
    conscience: 'why-conscience.py',
    causality: 'why-causality.py',
    'fractal-shape': 'why-fractal-shape.py',
    'architecture-snapshot': 'why-architecture-snapshot.py',
    search: 'why-search.py',
  };
  for (const a of args) {
    if (a === 'mode=freeze') run('python3', [path.join(ROOT, 'tools/HME/scripts/freeze-check.py'), ...stripSelector(args, 'freeze')]);
    const m = /^mode=(.+)$/.exec(a);
    if (m && modeMap[m[1]]) run('python3', [path.join(ROOT, 'tools/HME/scripts', modeMap[m[1]]), ...args]);
  }
  if (args.length > 1 || (args[0] || '').includes(' ') || (args[0] || '').includes('?')) {
    run('python3', [path.join(ROOT, 'tools/HME/scripts/why-search.py'), ...args]);
  }
  run('python3', [path.join(ROOT, 'tools/HME/scripts/why-invariant.py'), ...args]);
}

function dispatchLearn(args) {
  if (['learnings', 'learning'].includes(args[0])) run('python3', [path.join(ROOT, 'tools/HME/scripts/learning_extract.py'), ...(keyValueToFlags(args.slice(1)).length ? keyValueToFlags(args.slice(1)) : ['list'])]);
  if (['pattern', 'patterns'].includes(args[0])) run('python3', [path.join(ROOT, 'tools/HME/scripts/pattern-registry.py'), ...args.slice(1)]);
  for (const a of args) {
    if (a === 'action=learnings' || a === 'action=learning') {
      const rest = keyValueToFlags(args.filter((x) => x !== a));
      run('python3', [path.join(ROOT, 'tools/HME/scripts/learning_extract.py'), ...(rest.length ? rest : ['list'])]);
    }
  }
  hmeCli('learn', args);
}

function dispatchEvolve(args) {
  if (['spec', 'extract-spec'].includes(args[0])) run('python3', [path.join(ROOT, 'tools/HME/scripts/extract-spec.py'), ...args.slice(1)]);
  for (const a of args) {
    if (['action=extract-spec', 'action=spec', 'mode=extract-spec', 'mode=spec'].includes(a)) {
      run('python3', [path.join(ROOT, 'tools/HME/scripts/extract-spec.py'), ...args.filter((x) => x !== a)]);
    }
  }
  if (args.length === 0) run('python3', [path.join(ROOT, 'tools/HME/scripts/substrate-view.py'), 'actions']);
  hmeCli('evolve', args);
}

function dispatchTrace(args) {
  const out = [];
  let haveTarget = false;
  for (const a of args) {
    if (a.startsWith('target=')) haveTarget = true;
    if (!haveTarget && !a.startsWith('-') && !a.includes('=')) {
      out.push(`target=${a}`);
      haveTarget = true;
    } else {
      out.push(a);
    }
  }
  hmeCli('trace', out);
}

function dispatchReview(args) {
  const timeout = _hmeRequireEnv('HME_REVIEW_TIMEOUT');
  const r = spawnSync('timeout', [timeout, 'node', HME_CLI, 'review', ...args], { stdio: 'inherit', env: { ...process.env, PROJECT_ROOT: ROOT } });
  if (r.status === 124) {
    const msg = `[${new Date().toISOString()}] [i/review] wall-clock timeout after ${timeout}s -- worker deadlock? Args: ${args.join(' ')}`;
    console.error(msg);
    try { fs.appendFileSync(path.join(ROOT, 'log', 'hme-errors.log'), `${msg}\n`); } catch (_) {}
  }
  process.exit(r.status === null ? 1 : r.status);
}

function dispatchHme(args) {
  const first = args[0] || '';
  if (['admin', 'hme_admin'].includes(first)) hmeCli('hme_admin', args.slice(1));
  if (['selftest', 'reload', 'restart', 'index', 'clear_index', 'warm', 'introspect', 'validate', 'fix_antipattern', 'health', 'both'].includes(first)) hmeCli('hme_admin', [`action=${first}`, ...args.slice(1)]);
  if (first === 'read') {
    console.error('i/hme: explicit HME read is retired; use native Read. Read/Edit results are already HME-enriched.');
    process.exit(2);
  }
  if (first === 'todo' || first === 'hme_todo') {
    console.error('i/hme: explicit HME todo is retired; use native TodoWrite. TodoWrite calls are HME-merged automatically.');
    process.exit(2);
  }
  hmeCli(first, args.slice(1));
}

function dispatchHelp(args) {
  const reg = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  if (args[0] === '--json') {
    process.stdout.write(JSON.stringify(reg, null, 2) + '\n');
    process.exit(0);
  }
  const commands = reg.commands || {};
  if (args[0] && args[0] !== '--all') {
    const e = commands[args[0]];
    if (!e) {
      console.error(`i/help: '${args[0]}' not found in registry`);
      process.exit(1);
    }
    console.log(`i/${args[0]}\n  ${e.description || '(no description)'}\n  category: ${e.category || 'uncategorized'}`);
    if (e.usage) console.log(`\n  usage: ${e.usage}`);
    if (e.modes) console.log(`\n  modes: ${e.modes.join(', ')}`);
    if (e.examples) console.log(`\n  examples:\n${e.examples.map((x) => `    ${x}`).join('\n')}`);
    process.exit(0);
  }
  const groups = {};
  for (const [name, e] of Object.entries(commands)) {
    (groups[e.category || 'uncategorized'] ||= []).push([name, e.description || '']);
  }
  console.log('HME tool surface (i/):  use `i/help <name>` for detail\n');
  for (const cat of ['review-discipline', 'knowledge', 'diagnostic', 'evolution', 'policy-config', 'meta']) {
    if (!groups[cat]) continue;
    console.log(`[${cat}]`);
    for (const [name, desc] of groups[cat]) console.log(`  ${`i/${name}`.padEnd(16)}  ${desc.length > 100 ? desc.slice(0, 97) + '...' : desc}`);
    console.log('');
  }
}

const command = process.argv[2];
const args = process.argv.slice(3);
if (!command) dispatchHelp([]);
if (command === 'audit') dispatchAudit(args);
if (command === 'status') dispatchStatus(args);
if (command === 'why') dispatchWhy(args);
if (command === 'learn') dispatchLearn(args);
if (command === 'evolve') dispatchEvolve(args);
if (command === 'trace') dispatchTrace(args);
if (command === 'review') dispatchReview(args);
if (command === 'hme') dispatchHme(args);
if (command === 'policies') run('node', [path.join(ROOT, 'tools/HME/policies/cli.js'), ...args]);
if (command === 'help') dispatchHelp(args);
hmeCli(command, args);
