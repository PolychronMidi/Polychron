'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { stripCodexSystemNoise } = require('../../proxy/codex_system_noise');
const { applyRequestTransform } = require('../../proxy/codex_payload');

const PERMISSIONS_TEXT = '<permissions instructions>\nFilesystem sandboxing defines which files...\nsome long body\n</permissions instructions>';
const COLLAB_TEXT = '<collaboration_mode># Collaboration Mode: Default\n\nYou are now in Default mode.\n</collaboration_mode>';
const SKILLS_TEXT = '<skills_instructions>\n## Skills\nA skill is a set of local instructions...\n</skills_instructions>';

test('stripCodexSystemNoise drops permissions/collaboration_mode/skills_instructions wrapper items', () => {
  const body = {
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: PERMISSIONS_TEXT },
          { type: 'input_text', text: COLLAB_TEXT },
          { type: 'input_text', text: 'keep this user message' },
          { type: 'input_text', text: SKILLS_TEXT },
        ],
      },
    ],
  };
  const stats = {};
  const out = stripCodexSystemNoise(body, stats);
  assert.strictEqual(out.input[0].content.length, 1);
  assert.strictEqual(out.input[0].content[0].text, 'keep this user message');
  assert.strictEqual(stats.dropped, 3);
  assert.strictEqual(stats.categories.permissions_instructions, 1);
  assert.strictEqual(stats.categories.collaboration_mode, 1);
  assert.strictEqual(stats.categories.skills_instructions, 1);
  assert.ok(stats.removed_bytes > 0);
});

test('stripCodexSystemNoise leaves unrelated payloads unchanged', () => {
  const body = {
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'normal prompt' }] },
    ],
  };
  const stats = {};
  const out = stripCodexSystemNoise(body, stats);
  assert.strictEqual(out, body);
  assert.strictEqual(stats.dropped, 0);
});

test('stripCodexSystemNoise does not match partial fragments inside larger text', () => {
  const partial = `prefix\n${PERMISSIONS_TEXT}\nsuffix`;
  const body = {
    input: [{ role: 'user', content: [{ type: 'input_text', text: partial }] }],
  };
  const stats = {};
  const out = stripCodexSystemNoise(body, stats);
  assert.strictEqual(out.input[0].content.length, 1);
  assert.strictEqual(stats.dropped, 0);
});

test('codex_payload applyRequestTransform strips the three system noise wrappers and reports stats', () => {
  const cfg = { request_transform: { cleanup: { enabled: true } } };
  const body = {
    model: 'gpt-5.5',
    instructions: 'test',
    input: [
      {
        role: 'system',
        content: [
          { type: 'input_text', text: PERMISSIONS_TEXT },
          { type: 'input_text', text: COLLAB_TEXT },
          { type: 'input_text', text: SKILLS_TEXT },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'real user prompt' }],
      },
    ],
    tools: [{ type: 'function', name: 'update_plan' }],
    stream: true,
  };
  const result = applyRequestTransform(body, {
    loadConfig: () => cfg,
    record: () => {},
    projectRoot: process.cwd(),
  });
  assert.strictEqual(result.body.input[0].content.length, 0);
  assert.strictEqual(result.body.input[1].content[0].text, 'real user prompt');
  assert.strictEqual(result.cleanup.codex_system_noise, 3);
  assert.ok(result.cleanup.codex_system_noise_bytes > 0);
  assert.strictEqual(result.cleanup.codex_system_noise_categories.permissions_instructions, 1);
  assert.strictEqual(result.cleanup.codex_system_noise_categories.collaboration_mode, 1);
  assert.strictEqual(result.cleanup.codex_system_noise_categories.skills_instructions, 1);
});

test('system noise rules are shared by Claude and Codex cleanup', () => {
  const rules = require('../../proxy/system_noise_rules');
  const claude = require('../../proxy/middleware/00_strip_skill_reminder');
  assert.ok(rules.CLAUDE_STRIP_RULES.some((rule) => rule.name === 'skill'));
  assert.deepStrictEqual(rules.CODEX_WRAPPER_RULES.map((rule) => rule.name), [
    'permissions_instructions',
    'collaboration_mode',
    'skills_instructions',
  ]);
  assert.ok(rules.UNIVERSAL_REMOVE_BLOCK_RULES.some((rule) => rule.name === 'stop-hook-host-echo'));
  assert.ok(rules.CODEX_SYSTEM_NOISE_RULES.some((rule) => rule.name === 'stop-hook-host-echo'));
  assert.strictEqual(claude.name, 'strip_skill_reminder');
});


test('Codex cleanup strips Claude Stop hook host echo via universal noise rule', () => {
  const payload = {
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: 'Stop hook feedback:\n[node $PROJECT_ROOT/tools/HME/event_kernel/claude_adapter.js Stop]: EXHAUST PROTOCOL VIOLATION: noisy echo' },
        { type: 'input_text', text: 'real continuation request' },
      ],
    }],
  };
  const stats = {};
  const result = stripCodexSystemNoise(payload, stats);
  assert.notStrictEqual(result, payload);
  assert.strictEqual(stats.dropped, 1);
  assert.strictEqual(stats.categories['stop-hook-host-echo'], 1);
  assert.deepStrictEqual(result.input[0].content, [{ type: 'input_text', text: 'real continuation request' }]);
});

test('codex_payload preserves real input_text while replacing tools with the uniform surface', () => {
  const cfg = { request_transform: { cleanup: { enabled: true } } };
  const result = applyRequestTransform({
    model: 'gpt-5.5',
    input: [{ role: 'user', content: [{ type: 'input_text', text: 'ship the real task' }] }],
    tools: [{ type: 'function', name: 'exec_command' }, { type: 'function', name: 'apply_patch' }],
  }, { loadConfig: () => cfg, record: () => {}, projectRoot: process.cwd() });
  assert.strictEqual(result.body.input[0].content[0].text, 'ship the real task');
  assert.deepStrictEqual(result.after.tool_names, ['Agent', 'Bash', 'Edit', 'Read', 'WebFetch', 'WebSearch', 'Write']);
  assert.strictEqual(result.cleanup.native_tools_added, 7);
});


test('strips wrapper noise from input_text items', () => {
  const payload = {
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: '<permissions instructions>cwd=/tmp</permissions instructions>' },
          { type: 'input_text', text: 'real user request' },
        ],
      },
    ],
  };
  const stats = {};
  const result = stripCodexSystemNoise(payload, stats);
  assert.notEqual(result, payload);
  assert.equal(stats.dropped, 1);
  assert.deepEqual(result.input[0].content, [
    { type: 'input_text', text: 'real user request' },
  ]);
});

test('preserves real input_text content', () => {
  const payload = {
    input: [
      { role: 'user', content: [{ type: 'input_text', text: 'please keep this' }] },
    ],
  };
  const stats = {};
  const result = stripCodexSystemNoise(payload, stats);
  assert.strictEqual(result, payload);
  assert.equal(stats.dropped, 0);
});
