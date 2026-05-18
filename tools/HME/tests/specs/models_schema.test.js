'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const VALID_TIERS = new Set(['E1', 'E2', 'E3', 'E4', 'E5']);
const VALID_EFFORTS = new Set(['max', 'xhigh', 'high', 'medium', 'low']);

function loadModels() {
  const text = fs.readFileSync(path.join(repo, 'config', 'models.json'), 'utf8');
  const clean = text.split(/\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n');
  return JSON.parse(clean);
}

test('models.json schema: unique ids, valid tiers, valid effort variants', () => {
  const cfg = loadModels();
  assert.ok(cfg.tiers && typeof cfg.tiers === 'object');
  const anthropicSeen = new Set();
  for (const [tierName, tier] of Object.entries(cfg.tiers)) {
    assert.ok(VALID_TIERS.has(tierName), `valid tier ${tierName}`);
    assert.ok(Array.isArray(tier.models), `${tierName}.models array`);
    for (const model of tier.models) {
      assert.ok(model.id, `${tierName} model has id`);
      const uniqueKey = `${model.id}@@${model.provider || ''}`;
      assert.equal(seen.has(uniqueKey), false, `duplicate model/provider ${uniqueKey}`);
      seen.add(uniqueKey);
      assert.equal(typeof model.tier_score, 'number', `${model.id} tier_score number`);
      if (model.effort_level != null) {
        assert.ok(VALID_EFFORTS.has(model.effort_level), `${model.id} effort enum`);
        assert.ok(model.api_model, `${model.id} effort variant requires api_model`);
      }
      if (/^claude-opus-/.test(model.id)) {
        assert.equal(model.max_context, 1000000, `${model.id} opus max_context`);
        assert.equal(model.context_length, 1000000, `${model.id} opus context_length`);
      }
    }
  }
});
