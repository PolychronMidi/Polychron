'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');

test('lifecycle payload core normalizes shared fields while keeping host identity explicit', () => {
  const { buildHostPayload } = require('../../event_kernel/lifecycle_payload');
  const codex = JSON.parse(buildHostPayload({ host: 'codex', event: 'PreToolUse', root: repoRoot, rawBody: JSON.stringify({ thread_id: 't1' }), cwd: repoRoot, teamRole: 'driver' }));
  assert.equal(codex._hme_host, 'codex');
  assert.equal(codex._hme_event, 'PreToolUse');
  assert.equal(codex._hme_project_root, repoRoot);
  assert.equal(codex.session_id, 't1');
  assert.equal(codex._hme_team_role, 'driver');

  const claude = JSON.parse(buildHostPayload({ host: 'claude', event: 'UserPromptSubmit', root: repoRoot, rawBody: '{}', cwd: repoRoot }));
  assert.equal(claude._hme_host, 'claude');
  assert.equal(claude._hme_event, 'UserPromptSubmit');
});

test('decision normalizer keeps protocol rendering separate from shared decision parsing', () => {
  const { sanitizeCodexStdout, claudeRelayFields } = require('../../event_kernel/decision_normalizer');
  const reason = 'BLOCKED: shared reason';
  const raw = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }, systemMessage: reason });
  const codex = JSON.parse(sanitizeCodexStdout('PreToolUse', raw));
  assert.equal(codex.hookSpecificOutput.permissionDecisionReason, reason);
  assert.equal(Object.hasOwn(codex, 'systemMessage'), false);
  const claude = claudeRelayFields('PreToolUse', { stdout: raw, stderr: '', exit_code: 0 });
  assert.equal(claude.exit_code, 0);
  assert.equal(claude.stderr, ' ');
  assert.deepEqual(JSON.parse(claude.stdout).hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: reason,
  });

  const claudeStop = claudeRelayFields('Stop', { stdout: JSON.stringify({ decision: 'block', reason }), stderr: '', exit_code: 0 });
  assert.equal(claudeStop.exit_code, 0);
  assert.equal(claudeStop.stdout, JSON.stringify({ decision: 'block', reason }));
  assert.equal(claudeStop.stderr, ' ');
});

test('Claude adapter repairs invalid PreToolUse stdout into Lifesaver deny', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-pretool-lifesaver-'));
  try {
    const { validateClaudeStdout } = require('../../event_kernel/claude_adapter');
    const out = JSON.parse(validateClaudeStdout('PreToolUse', JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: 'missing event' } }), tmp));
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\[ALERT\] LIFESAVER/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /hookSpecificOutput missing hookEventName/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('Claude adapter PreToolUse deny stays structured stdout without hook-error stderr', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-adapter-deny-'));
  try {
    const transcript = path.join(tmp, 'transcript.jsonl');
    const cmd = `adapter-repeat-command-${process.pid}-${Date.now()}`;
    const prior = {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_adapter', name: 'Bash', input: { command: cmd } }] },
    };
    fs.writeFileSync(transcript, `${JSON.stringify(prior)}\n`);
    const input = { transcript_path: transcript, tool_name: 'Bash', tool_input: { command: cmd } };
    const out = execFileSync('node', [path.join(repoRoot, 'tools/HME/event_kernel/claude_adapter.js'), 'PreToolUse'], {
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        PROJECT_ROOT: repoRoot,
        HME_PROXY_PORT: '9',
        HME_PETULANCE_STATE_PATH: path.join(tmp, 'state.json'),
        HME_ADAPTER_NO_NUDGE: '1',
      },
    });
    const stdout = JSON.parse(out);
    assert.equal(stdout.hookSpecificOutput.permissionDecision, 'deny');
    assert.equal(stdout.hookSpecificOutput.permissionDecisionReason, '[SPIRALLING_PETULANCE] - blocked repeated command with no intervening edit. No command spam.');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Claude Stop policy feedback relays as root block stdout', () => {
  const { claudeRelayFields } = require('../../event_kernel/decision_normalizer');
  const reason = 'Stop hook feedback: AUTO-COMPLETENESS CHECK compacted by hme-proxy.';
  const relayed = claudeRelayFields('Stop', {
    stdout: JSON.stringify({ decision: 'block', reason }),
    stderr: '',
    exit_code: 0,
  });
  assert.equal(relayed.exit_code, 0);
  assert.equal(relayed.stderr, ' ');
  assert.deepEqual(JSON.parse(relayed.stdout), { decision: 'block', reason });
});


test('Claude adapter converts invalid Stop hookSpecificOutput into valid root block', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stop-hso-repair-'));
  try {
    const { validateClaudeStdout } = require('../../event_kernel/claude_adapter');
    const out = JSON.parse(validateClaudeStdout('Stop', JSON.stringify({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'STOP REASON' } }), tmp));
    assert.deepEqual(out, { decision: 'block', reason: 'STOP REASON' });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Claude adapter converts invalid hook stdout into valid Lifesaver block JSON', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-invalid-json-'));
  try {
    const { validateClaudeStdout } = require('../../event_kernel/claude_adapter');
    const out = JSON.parse(validateClaudeStdout('Stop', '{bad json', tmp));
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /JSON validation failed/);
    assert.match(fs.readFileSync(path.join(tmp, 'log', 'hme-errors.log'), 'utf8'), /hook-output-validation/);
    assert.match(fs.readFileSync(path.join(tmp, 'log', 'hme.log'), 'utf8'), /ERROR hook-output-validation/);
    const lineCount = fs.readFileSync(path.join(tmp, 'log', 'hme-errors.log'), 'utf8').trim().split(/\r?\n/).length;
    assert.equal(lineCount, 1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Claude adapter logs and repairs UserPromptSubmit JSON rejected by host schema', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-userprompt-invalid-shape-'));
  try {
    const { validateClaudeStdout } = require('../../event_kernel/claude_adapter');
    const raw = JSON.stringify({
      hookSpecificOutput: { additionalContext: 'lifesaver context' },
      decision: 'allow',
      reason: 'diagnostic only',
    });
    const out = JSON.parse(validateClaudeStdout('UserPromptSubmit', raw, tmp));
    assert.deepEqual(out, {
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: 'lifesaver context',
      },
    });
    const errors = fs.readFileSync(path.join(tmp, 'log', 'hme-errors.log'), 'utf8');
    assert.match(errors, /hook-output-validation/);
    assert.match(errors, /UserPromptSubmit root decision="allow" is not valid Claude hook JSON/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});


test('Claude adapter blocks scalar UserPromptSubmit JSON and emits Lifesaver context', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-userprompt-scalar-'));
  try {
    const { validateClaudeStdout } = require('../../event_kernel/claude_adapter');
    const out = JSON.parse(validateClaudeStdout('UserPromptSubmit', '[]', tmp));
    assert.equal(out.decision, 'block');
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /Hook JSON output validation failed/);
    assert.match(fs.readFileSync(path.join(tmp, 'log', 'hme-errors.log'), 'utf8'), /stdout JSON root must be an object/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Claude adapter does not log benign ok stderr as Lifesaver error', () => {
  const { shouldLogHookStderr } = require('../../event_kernel/claude_adapter');
  const { isBenignHookStderr, claudeRelayFields } = require('../../event_kernel/decision_normalizer');
  assert.equal(shouldLogHookStderr('ok'), false);
  assert.equal(shouldLogHookStderr('ok\nok'), false);
  assert.equal(shouldLogHookStderr('JSON validation failed'), true);
  assert.equal(shouldLogHookStderr('MULTI-FLAG STOP (2 detectors firing): EXHAUST, SPIRALLING_PETULANCE.'), true);
  assert.equal(shouldLogHookStderr('[ALERT] LIFESAVER - MID-TURN ERRORS DETECTED:\n[autocommit:proxy] [onRequest] git commit failed twice: ERROR: pre-commit validation blocked this commit.'), false);
  assert.equal(shouldLogHookStderr('[autocommit:proxy] [onRequest] git commit failed twice: ERROR: pre-commit validation blocked this commit.'), false);
  assert.equal(shouldLogHookStderr('HME proxy already running on :9099\nOnboarding: 6/7 await verdict\nPipeline: STABLE'), false);
  assert.equal(isBenignHookStderr('ok\nok'), true);
  assert.equal(claudeRelayFields('PostToolUse', { stdout: '', stderr: 'ok\nok', exit_code: 0 }).stderr, ' ');
});


test('Claude adapter does not log expected Stop block directives as errors', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-stop-block-no-error-log-'));
  try {
    const adapterPath = path.join(repoRoot, 'tools/HME/event_kernel/claude_adapter.js');
    const reason = 'MULTI-FLAG STOP (2 detectors firing): EXHAUST, SPIRALLING_PETULANCE.\nAddress all of them in this turn.';
    const stdoutJson = JSON.stringify(JSON.stringify({ decision: 'block', reason }));
    const bodyJson = JSON.stringify(JSON.stringify({ _hme_project_root: tmp }));
    execFileSync('node', ['-e', [
      `const { finalRelay } = require(${JSON.stringify(adapterPath)});`,
      `finalRelay('Stop', { stdout: ${stdoutJson}, stderr: '', exit_code: 0 }, ${bodyJson});`,
    ].join('\n')], {
      encoding: 'utf8',
      env: { ...process.env, PROJECT_ROOT: tmp, HME_ADAPTER_NO_NUDGE: '1' },
    });
    assert.equal(fs.existsSync(path.join(tmp, 'log', 'hme-errors.log')), false);
    assert.equal(fs.existsSync(path.join(tmp, 'log', 'hme.log')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Claude Stop root block stays structured stdout and never surfaces policy stderr as hook error', () => {
  const { claudeRelayFields } = require('../../event_kernel/decision_normalizer');
  const reason = 'EXHAUST PROTOCOL VIOLATION: fix work';
  const fields = claudeRelayFields('Stop', { stdout: JSON.stringify({ decision: 'block', reason }), stderr: 'FAIL: detectors policy blocked', exit_code: 0 });
  assert.deepEqual(JSON.parse(fields.stdout), { decision: 'block', reason });
  assert.equal(fields.stderr, ' ');
  assert.equal(fields.exit_code, 0);
});

test('lifecycle status stderr is converted to context instead of error channel', () => {
  const { lifecycleContextResult } = require('../../event_kernel/dispatcher');
  const out = lifecycleContextResult('SessionStart', { stdout: '', stderr: 'Pipeline: STABLE\nCarried-over HME todos (0 open)', exit_code: 0 });
  const parsed = JSON.parse(out.stdout);
  assert.equal(out.stderr, ' ');
  assert.match(parsed.hookSpecificOutput.additionalContext, /Pipeline: STABLE/);
});

test('request transform core remains protocol-aware for Codex cleanup', () => {
  const { applyRequestTransform } = require('../../proxy/codex_payload');
  const result = applyRequestTransform({
    model: 'gpt-test',
    input: [{ role: 'system', content: [{ type: 'input_text', text: 'PreToolUse hook (completed)\nkeep' }, { type: 'input_text', text: '   ' }] }],
    tools: [],
  }, { loadConfig: () => ({ request_transform: { cleanup: { enabled: true } } }), record: () => {}, projectRoot: repoRoot });
  assert.equal(result.body.input[0].content.length, 1);
  assert.match(result.body.input[0].content[0].text, /keep/);
  assert.equal(result.cleanup.categories.hook_success_lines, 1);
  assert.equal(result.cleanup.categories.empty_text_items, 1);
});

test('conversation graph scrub removes orphan pairs and preserves non-empty turns', () => {
  const { scrubOrphanToolPairs, sanitizeMessages, toGraph } = require('../../proxy/conversation_graph');
  const payload = { messages: [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'a', name: 'Read', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'orphan' }] },
    { role: 'user', content: [{ type: 'text', text: '   ' }] },
  ] };
  assert.equal(scrubOrphanToolPairs(payload), 2);
  assert.equal(sanitizeMessages(payload), 1);
  assert.match(payload.messages[0].content[0].text, /SUCCESS|stripped/);
  assert.equal(toGraph(payload)[0].blocks[0].kind, 'text');
});

test('tool-result semantics centralizes empty success and fail markers', () => {
  const { markEmptyResult, SUCCESS_EMPTY, FAIL_EMPTY } = require('../../proxy/tool_result_semantics');
  const ok = { content: '' };
  const fail = { content: [], is_error: true };
  assert.equal(markEmptyResult(ok), true);
  assert.equal(ok.content, SUCCESS_EMPTY);
  assert.equal(markEmptyResult(fail), true);
  assert.deepEqual(fail.content, [{ type: 'text', text: FAIL_EMPTY }]);
});

test('model route resolver keeps Codex Responses target separate from direct path', () => {
  const { targetChain, targetSummary } = require('../../proxy/codex_omniroute');
  const env = { HME_CODEX_OMNIROUTE_MODE: 'upstream', HME_CODEX_OMNIROUTE_PROVIDER: 'cx' };
  const chain = targetChain({ model: 'gpt-x' }, 'https://direct.example/responses', () => ({ omniroute: { enabled: true, url: 'http://127.0.0.1:1/v1/responses' } }), env);
  assert.equal(chain[0].kind, 'omniroute');
  assert.equal(chain[0].body.model, 'cx/gpt-x');
  assert.equal(chain[1].kind, 'direct');
  assert.deepEqual(targetSummary(chain).map((x) => x.kind), ['omniroute', 'direct']);
});

test('request telemetry emits prompt-free normalized request metadata', () => {
  const { requestTelemetry } = require('../../proxy/request_telemetry');
  const row = requestTelemetry({ host: 'codex', protocol: 'openai-responses', provider: 'omniroute', route: 'omniroute', path: '/v1/responses', before: { model: 'gpt-x' }, after: { model: 'cx/gpt-x', body_bytes: 10, instruction_bytes: 2, text_bytes: 3, tool_count: 1 }, cleanup: { removed_lines: 1 } });
  assert.equal(row.host, 'codex');
  assert.equal(row.protocol, 'openai-responses');
  assert.equal(row.model, 'cx/gpt-x');
  assert.equal(JSON.stringify(row).includes('secret prompt'), false);
});

test('universal lifecycle graph records redacted checkpoints and forks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-universal-lifecycle-'));
  try {
    process.env.PROJECT_ROOT = root;
    process.env.HME_RUNTIME_DIR = path.join(root, 'tools', 'HME', 'runtime');
    fs.mkdirSync(process.env.HME_RUNTIME_DIR, { recursive: true });
    const graphPath = require.resolve('../../event_kernel/lifecycle_graph');
    const ttPath = require.resolve('../../event_kernel/lifecycle_time_travel');
    delete require.cache[graphPath];
    delete require.cache[ttPath];
    const { createLifecycleGraph } = require('../../event_kernel/lifecycle_graph');
    const tt = require('../../event_kernel/lifecycle_time_travel');
    const payload = { session_id: 's2', turn_id: 't2', user_prompt: 'private text' };
    const graph = createLifecycleGraph({ root, host: 'codex', event: 'UserPromptSubmit', body: JSON.stringify(payload), payload });
    graph.checkpoint('adapter:received', { rawBody: JSON.stringify(payload) }, 'input');
    graph.recordTransport('proxy', { stdout: 'private stdout', stderr: '', exit_code: 0 });
    const hist = tt.history(root, graph.thread_id);
    assert.equal(hist.length, 2);
    assert.equal(hist[0].phase, 'transport:proxy');
    assert.equal(hist[1].phase, 'adapter:received');
    assert.equal(JSON.stringify(hist).includes('private text'), false);
    assert.equal(JSON.stringify(hist).includes('private stdout'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('hook lifecycle time-travel ledger records redacted checkpoints and forks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-hook-time-travel-'));
  try {
    process.env.PROJECT_ROOT = root;
    process.env.HME_RUNTIME_DIR = path.join(root, 'tools', 'HME', 'runtime');
    fs.mkdirSync(process.env.HME_RUNTIME_DIR, { recursive: true });
    const ttPath = require.resolve('../../event_kernel/lifecycle_time_travel');
    delete require.cache[ttPath];
    const tt = require('../../event_kernel/lifecycle_time_travel');
    const payload = { session_id: 's1', turn_id: 't1', user_prompt: 'secret prompt text' };
    const first = tt.checkpoint({ root, host: 'claude', event: 'UserPromptSubmit', payload, phase: 'received', values: { rawInput: JSON.stringify(payload) } });
    const second = tt.checkpoint({ root, host: 'claude', event: 'UserPromptSubmit', payload, phase: 'validated', values: { stdout: 'secret output' } });
    assert.equal(second.parent_id, first.checkpoint_id);
    const hist = tt.history(root, first.thread_id);
    assert.equal(hist.length, 2);
    assert.equal(hist[0].phase, 'validated');
    assert.equal(Object.hasOwn(hist[0].values, 'stdout'), false);
    assert.equal(Object.hasOwn(hist[0].values, 'stdout_bytes'), true);
    assert.equal(JSON.stringify(hist).includes('secret prompt text'), false);
    const forked = tt.fork(root, first.checkpoint_id, { values: { policy: 'alternate' } });
    assert.equal(forked.parent_id, first.checkpoint_id);
    assert.equal(forked.source, 'fork');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('turn side effects expose shared lifesaver/autocommit interfaces without forcing host protocol', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-turn-effects-'));
  try {
    fs.mkdirSync(path.join(root, 'tools', 'HME', 'runtime'), { recursive: true });
    const { failFlagPath, injectLifesaver } = require('../../proxy/turn_side_effects');
    const flag = failFlagPath(root, 'autocommit.fail');
    fs.writeFileSync(flag, JSON.stringify({ banner: 'failure banner' }));
    const out = injectLifesaver({ body: { instructions: 'base' }, host: 'codex', projectRoot: root });
    assert.equal(out.injected, true);
    assert.match(out.body.instructions, /base/);
    assert.match(out.body.instructions, /failure banner/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
