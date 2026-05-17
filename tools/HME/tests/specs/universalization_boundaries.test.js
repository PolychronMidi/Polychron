'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
  const raw = JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: reason }, systemMessage: reason });
  const codex = JSON.parse(sanitizeCodexStdout('PreToolUse', raw));
  assert.equal(codex.hookSpecificOutput.permissionDecisionReason, reason);
  assert.equal(Object.hasOwn(codex, 'systemMessage'), false);
  const claude = claudeRelayFields('PreToolUse', { stdout: raw, stderr: '', exit_code: 0 });
  assert.equal(claude.exit_code, 2);
  assert.equal(claude.stderr, reason);

  const claudeStop = claudeRelayFields('Stop', { stdout: JSON.stringify({ decision: 'block', reason }), stderr: '', exit_code: 0 });
  assert.equal(claudeStop.exit_code, 0);
  assert.equal(claudeStop.stdout, JSON.stringify({ decision: 'block', reason }));
  assert.equal(claudeStop.stderr, ' ');
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
