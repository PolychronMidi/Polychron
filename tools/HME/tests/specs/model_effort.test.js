'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { effortParamsForProvider, applyEffortParams } = require('../../proxy/model_effort');

test('Claude/Anthropic effort variants do not emit schema-extra thinkingLevel', () => {
  for (const effort of ['max', 'xhigh', 'high', 'medium', 'low']) {
    assert.equal(effortParamsForProvider({ provider: 'anthropic', effort_level: effort }), null);
    assert.equal(effortParamsForProvider({ provider: 'claude', effort_level: effort }), null);
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
  const payload = { model: 'cx/gpt-5.5' };
  assert.equal(applyEffortParams(payload, { provider: 'codex', effort_level: 'high' }), true);
  assert.equal(payload.reasoning_effort, 'high');
  assert.equal(applyEffortParams(payload, { provider: 'codex', effort_level: 'invalid' }), false);
});
