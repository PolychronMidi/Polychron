'use strict';
/**
 * Model-classifier contract. Pins the family/tier table and the claude-shape
 * helpers so the de-scattered classifier behaves identically to the former
 * inline tests in overdrive_route.js + hme_proxy_opus_gate.js, and so future
 * edits to the family map are an explicit, reviewed change.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const mc = require('../../proxy/model_classifier');

test('modelTier maps families to overdrive bands; unknown -> default top band', () => {
  assert.equal(mc.modelTier('claude-opus-4-20250101'), 'E5');
  assert.equal(mc.modelTier('claude-sonnet-4-20250101'), 'E4');
  assert.equal(mc.modelTier('claude-haiku-4-20250101'), 'E2');
  assert.equal(mc.modelTier('gpt-5-something'), 'E5');
  assert.equal(mc.modelTier(''), 'E5');
  assert.equal(mc.modelTier(null), 'E5');
});

test('family is case-insensitive and substring-based', () => {
  assert.equal(mc.family('Claude-OPUS-4'), 'opus');
  assert.equal(mc.family('anthropic/claude-sonnet-4'), 'sonnet');
  assert.equal(mc.family('mystery-model'), '');
});

test('isOpus matches exactly the opus family', () => {
  assert.equal(mc.isOpus('claude-opus-4-1'), true);
  assert.equal(mc.isOpus('claude-sonnet-4'), false);
  assert.equal(mc.isOpus('gpt-4'), false);
});

test('claudeModel returns bare claude-* ids only', () => {
  assert.equal(mc.claudeModel('claude-opus-4'), 'claude-opus-4');
  assert.equal(mc.claudeModel('anthropic/claude-opus-4'), '');
  assert.equal(mc.claudeModel('gpt-4'), '');
});

test('providerPrefixedClaudeModel unwraps anthropic|claude prefixes only', () => {
  assert.equal(mc.providerPrefixedClaudeModel('anthropic/claude-opus-4'), 'claude-opus-4');
  assert.equal(mc.providerPrefixedClaudeModel('claude/claude-sonnet-4'), 'claude-sonnet-4');
  assert.equal(mc.providerPrefixedClaudeModel('openai/gpt-4'), '');
  assert.equal(mc.providerPrefixedClaudeModel('cx/claude-opus-4'), '');
  assert.equal(mc.providerPrefixedClaudeModel('claude-opus-4'), '');
});

test('FAMILY_TABLE rows are well-formed and ordered first-match-wins', () => {
  assert.ok(Array.isArray(mc.FAMILY_TABLE) && mc.FAMILY_TABLE.length >= 3);
  for (const row of mc.FAMILY_TABLE) {
    assert.equal(typeof row.family, 'string');
    assert.match(row.tier, /^E[0-9]$/);
    assert.equal(typeof row.needle, 'string');
  }
});

test('classifier matches the legacy inline behavior it replaces', () => {
  // Mirror overdrive_route.modelTier + hme_proxy_opus_gate /opus/i.
  const legacyTier = (id) => {
    const m = String(id || '').toLowerCase();
    if (m.includes('opus')) return 'E5';
    if (m.includes('sonnet')) return 'E4';
    if (m.includes('haiku')) return 'E2';
    return 'E5';
  };
  for (const id of ['claude-opus-4', 'claude-sonnet-4', 'claude-haiku-4', 'gpt-4', '', 'OPUS']) {
    assert.equal(mc.modelTier(id), legacyTier(id), `tier mismatch for ${id}`);
    assert.equal(mc.isOpus(id), /opus/i.test(String(id)), `opus mismatch for ${id}`);
  }
});
