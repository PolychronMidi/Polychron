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
