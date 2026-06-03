'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

const root = requireEnv('PROJECT_ROOT');
const selfOrigin = require('../../proxy/self_origin');

// Pull the alternation tokens out of a `^\[( ... )\]` style regex/grep source.
function tagsFromAlternation(group) {
  return group.split('|')
    .map((t) => t.trim())
    .filter(Boolean)
    // normalize the variadic worker:/sessionstart: tokens to a stable stem so
    // bracket-class spelling differences ([^]]+ vs [^\]]+) don't cause false drift.
    .map((t) => t.replace(/:\[\^\\?\]\]\+$/, ':*'));
}

function selfOriginTags() {
  const m = /\^\\\[\(([^]*?)\)\\\]/.exec(selfOrigin.SELF_TAG_RE.source);
  assert.ok(m, 'self_origin SELF_TAG_RE must be a ^[(...)]  alternation');
  return new Set(tagsFromAlternation(m[1]));
}

function bashTags() {
  const src = fs.readFileSync(path.join(root, 'tools/HME/hooks/helpers/_self_tags.sh'), 'utf8');
  const m = /\^\\\[\(([^]*?)\)\\\]/.exec(src);
  assert.ok(m, '_self_tags.sh must expose a ^[(...)] alternation');
  return new Set(tagsFromAlternation(m[1]));
}

function lifesaverTags() {
  const src = fs.readFileSync(path.join(root, 'tools/HME/proxy/middleware/22_lifesaver_inject.js'), 'utf8');
  const m = /SELF_TAG_RE = \/\^\\\[\(([^]*?)\)\\\]\//.exec(src);
  assert.ok(m, '22_lifesaver_inject must define SELF_TAG_RE');
  return new Set(tagsFromAlternation(m[1]));
}

test('self_origin.js is a superset of the bash _self_tags.sh tag set (no drift)', () => {
  const sup = selfOriginTags();
  const missing = [...bashTags()].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `self_origin.js missing canonical bash tags: ${missing.join(', ')}`);
});

test('self_origin.js is a superset of the 22_lifesaver_inject SELF_TAG_RE tag set (no drift)', () => {
  const sup = selfOriginTags();
  const missing = [...lifesaverTags()].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `self_origin.js missing 22_lifesaver_inject tags: ${missing.join(', ')}`);
});

function contextStatusTags() {
  const src = fs.readFileSync(path.join(root, 'tools/HME/proxy/context_status.js'), 'utf8');
  const m = /_SELF_TAG_RE = \/\\\[\(([^]*?)\)\\\]\//.exec(src);
  assert.ok(m, 'context_status must define _SELF_TAG_RE');
  return new Set(tagsFromAlternation(m[1]));
}

// The agent-actionable override set documents the PROVEN-intentional reason the
// live LIFESAVER subsets diverge from the canonical self-origin set: opencode-*
test('every agent-actionable override IS a canonical self-origin tag', () => {
  const sup = selfOriginTags();
  const missing = [...selfOrigin.AGENT_ACTIONABLE_OVERRIDES].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `override tags absent from canonical SELF_TAG_RE: ${missing.join(', ')}`);
});

test('live LIFESAVER subsets deliberately OMIT the agent-actionable overrides (proven carve-out)', () => {
  const live = lifesaverTags();
  const status = contextStatusTags();
  for (const tag of selfOrigin.AGENT_ACTIONABLE_OVERRIDES) {
    assert.ok(!live.has(tag), `22_lifesaver_inject must NOT suppress agent-actionable ${tag}`);
    assert.ok(!status.has(tag), `context_status must NOT suppress agent-actionable ${tag}`);
  }
});

test('isSelfOriginSuppressed surfaces overrides but suppresses pure infra', () => {
  // opencode-* is self-origin BY TAG but agent-actionable -> NOT suppressed.
  assert.equal(selfOrigin.isSelfOrigin('[opencode-stderr] ERROR schema invalid'), true);
  assert.equal(selfOrigin.isAgentActionableOverride('[opencode-stderr] ERROR schema invalid'), true);
  assert.equal(selfOrigin.isSelfOriginSuppressed('[opencode-stderr] ERROR schema invalid'), false);
  // pure infra self-origin -> suppressed.
  assert.equal(selfOrigin.isSelfOriginSuppressed('[proxy-watchdog] restarted slot a'), true);
  // agent error with no self-origin tag -> never suppressed.
  assert.equal(selfOrigin.isSelfOriginSuppressed('[2026-01-01T00:00:00Z] test failure in foo'), false);
});
