'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');

function loadModels() {
  const text = fs.readFileSync(path.join(repo, 'config', 'models.json'), 'utf8');
  const clean = text.split(/\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  return JSON.parse(clean);
}

test('Anthropic effort variants are registered in requested tiers', () => {
  const cfg = loadModels();
  const expected = [
    ['E5', 'claude-opus-4-7-max-e5', 'opus', 'max', 9],
    ['E4', 'claude-opus-4-7-xhigh-e4', 'opus', 'xhigh', 9],
    ['E4', 'claude-opus-4-7-high-e4', 'opus', 'high', 7],
    ['E3', 'claude-opus-4-7-medium-e3', 'opus', 'medium', 9],
    ['E3', 'claude-opus-4-7-low-e3', 'opus', 'low', 7],
    ['E3', 'claude-sonnet-4-6-max-e3', 'sonnet', 'max', 6],
    ['E3', 'claude-sonnet-4-6-xhigh-e3', 'sonnet', 'xhigh', 5],
    ['E2', 'claude-sonnet-4-6-high-e2', 'sonnet', 'high', 8],
    ['E2', 'claude-sonnet-4-6-medium-e2', 'sonnet', 'medium', 7],
    ['E2', 'claude-sonnet-4-6-low-e2', 'sonnet', 'low', 6],
    ['E2', 'claude-haiku-4-5-max-e2', 'haiku', 'max', 3],
    ['E1', 'claude-haiku-4-5-max-e1', 'haiku', 'max', 3],
  ];
  for (const [tier, id, family, effort, score] of expected) {
    const model = cfg.tiers[tier].models.find((m) => m.id === id);
    assert.ok(model, `${id} exists in ${tier}`);
    assert.equal(model.provider, 'anthropic');
    assert.equal(model.maker, 'Anthropic');
    assert.equal(model.effort_level, effort);
    assert.equal(model.tier_score, score);
    assert.match(model.api_model, new RegExp(`claude-${family}`));
    assert.equal(model.max_context, undefined, `${id} max_context retired`);
    if (family === 'opus') {
      assert.equal(model.context_length, 1000000, `${id} context_length`);
      assert.equal(model.max_input_tokens, 872000, `${id} max_input_tokens`);
    }
    if (family === 'sonnet' || family === 'haiku') {
      assert.equal(model.context_length, 200000, `${id} context_length`);
    }
  }
});

test('Anthropic effort variant ids are unique across registry', () => {
  const cfg = loadModels();
  const ids = [];
  for (const tier of Object.values(cfg.tiers)) {
    for (const model of tier.models || []) ids.push(model.id);
  }
  const anthropicIds = ids.filter((id) => /^claude-(opus|sonnet|haiku)-/.test(id));
  assert.equal(new Set(anthropicIds).size, anthropicIds.length);
});
