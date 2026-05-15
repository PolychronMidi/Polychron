'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../../proxy/shared');

const DEFAULT_POLICY = Object.freeze({
  warn_score: 50,
  block_score: 70,
  costs: { Bash: 15, Edit: 10, Grep: 20 },
  reset_tools: ['Read'],
  cost_summary: 'Bash=15, Edit=10, Grep=20; native Read resets',
  preferred_exit: 'use native Read/Edit/TodoWrite, run a different HME diagnostic class, or stop if done',
  reminder: 'Prefer HME tools; native Read resets and Read/Edit are KB-enriched.',
});

function loadPolicy() {
  const file = path.join(PROJECT_ROOT, 'tools', 'HME', 'config', 'raw-streak.json');
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch (_e) {
    return { ...DEFAULT_POLICY };
  }
}

function thresholds(env = process.env) {
  const policy = loadPolicy();
  const bump = Number(env.HME_STREAK_BLOCK_BUMP || 0) || 0;
  return {
    policy,
    warn: Number(policy.warn_score || DEFAULT_POLICY.warn_score) + bump,
    block: Number(policy.block_score || DEFAULT_POLICY.block_score) + bump,
  };
}

function blockMessage(score, block) {
  const policy = loadPolicy();
  return `BLOCKED: Raw tool streak ${score}/${block} (cost: ${policy.cost_summary}).\n  Reset now: ${policy.preferred_exit}.`;
}

function reminderMessage(score, block) {
  return `REMINDER: Raw tool streak ${score}/${block}. ${loadPolicy().reminder}`;
}

module.exports = { loadPolicy, thresholds, blockMessage, reminderMessage };
