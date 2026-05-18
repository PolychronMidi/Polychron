'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { effortParamsForProvider, applyEffortParams } = require('../../proxy/model_effort');

test('Anthropic effort variants map to thinkingLevel', () => {
  for (const effort of ['max', 'xhigh', 'high', 'medium', 'low']) {
    assert.deepEqual(effortParamsForProvider({ provider: 'anthropic', effort_level: effort }), { thinkingLevel: effort });
  }
});

test('OpenAI/Codex effort variants map to reasoning_effort params', () => {
  assert.deepEqual(effortParamsForProvider({ provider: 'codex', effort_level: 'max' }), {
    reasoning_effort: 'xhigh',
    reasoning_summary: 'detailed',
    reasoning: { effort: 'xhigh', summary: 'detailed' },
  });
  assert.deepEqual(effortParamsForProvider({ provider: 'openai', effort_level: 'medium' }), {
    reasoning_effort: 'medium',
    reasoning_summary: 'detailed',
    reasoning: { effort: 'medium', summary: 'detailed' },
  });
});

test('applyEffortParams mutates payload only for valid effort variants', () => {
  const payload = { model: 'anthropic/claude-opus-4-7' };
  assert.equal(applyEffortParams(payload, { provider: 'anthropic', effort_level: 'high' }), true);
  assert.equal(payload.thinkingLevel, 'high');
  assert.equal(applyEffortParams(payload, { provider: 'anthropic', effort_level: 'invalid' }), false);
});
