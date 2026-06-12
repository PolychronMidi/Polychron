'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('node:fs');
const _path = require('node:path');
const { spawnSync } = require('node:child_process');
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

function suppressedTags() {
  const m = /\^\\\[\(([^]*?)\)\\\]/.exec(selfOrigin.SELF_SUPPRESSED_TAG_RE.source);
  assert.ok(m, 'self_origin SELF_SUPPRESSED_TAG_RE must be a ^[(...)] alternation');
  return new Set(tagsFromAlternation(m[1]));
}

function bashSuppressedTags() {
  const helper = _path.join(root, 'tools/HME/hooks/helpers/_self_tags.sh');
  const r = spawnSync('bash', ['-lc', `source ${JSON.stringify(helper)}; _hme_self_tag_re`], {
    cwd: root,
    env: { ...process.env, PROJECT_ROOT: root },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, `_self_tags.sh should run cleanly: ${r.stderr}`);
  const m = /\^\\\[\(([^]*?)\)\\\]/.exec(r.stdout.trim());
  assert.ok(m, `_self_tags.sh must emit a ^[(...)] alternation, got: ${r.stdout}`);
  return new Set(tagsFromAlternation(m[1]));
}

function fileText(rel) {
  return _fs.readFileSync(_path.join(root, rel), 'utf8');
}

test('self_origin.js suppression set is a subset of the canonical self-origin tag set', () => {
  const sup = selfOriginTags();
  const missing = [...suppressedTags()].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `SELF_SUPPRESSED_TAG_RE tags absent from canonical SELF_TAG_RE: ${missing.join(', ')}`);
});

test('bash _self_tags.sh emits the canonical suppression tag set from self_origin.js (no hand-maintained drift)', () => {
  assert.deepEqual(bashSuppressedTags(), suppressedTags());
});

test('live JS consumers use self_origin.js, not hand-maintained SELF_TAG_RE subsets', () => {
  const lifesaver = fileText('tools/HME/proxy/middleware/22_lifesaver_inject.js');
  const status = fileText('tools/HME/proxy/context_status.js');
  assert.match(lifesaver, /require\('\.\.\/self_origin'\)/);
  assert.match(status, /require\('\.\/self_origin'\)/);
  assert.ok(!/const\s+SELF_TAG_RE\s*=/.test(lifesaver), '22_lifesaver_inject must not re-declare SELF_TAG_RE');
  assert.ok(!/_SELF_TAG_RE\s*=/.test(status), 'context_status must not re-declare _SELF_TAG_RE');
});

test('live hook consumers derive self-tags from canonical, not a hand-maintained subset', () => {
  // The alternation that must never be hand-copied into a consumer.
  const handMirror = /_safe_curl\|_safe_jq\|_safe_py3/;
  const ups = fileText('tools/HME/hooks/lifecycle/userpromptsubmit.sh');
  const cw = fileText('tools/HME/hooks/helpers/lifesaver_crying_wolf.py');
  assert.match(ups, /_hme_self_tag_re/, 'userpromptsubmit.sh must use _hme_self_tag_re');
  assert.ok(!handMirror.test(ups), 'userpromptsubmit.sh must not inline a hand-maintained self-tag alternation');
  assert.match(cw, /SELF_SUPPRESSED_TAG_PATTERNS/, 'lifesaver_crying_wolf.py must derive from self_origin SELF_SUPPRESSED_TAG_PATTERNS');
  assert.ok(!handMirror.test(cw), 'lifesaver_crying_wolf.py must not inline a hand-maintained self-tag alternation');
});

// The agent-actionable override set documents the PROVEN-intentional reason the
// live suppression set diverges from the canonical self-origin set: opencode-*
test('every agent-actionable override IS a canonical self-origin tag', () => {
  const sup = selfOriginTags();
  const missing = [...selfOrigin.AGENT_ACTIONABLE_OVERRIDES].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `override tags absent from canonical SELF_TAG_RE: ${missing.join(', ')}`);
});

test('live suppression set deliberately OMITS the agent-actionable overrides (proven carve-out)', () => {
  const liveSuppressed = suppressedTags();
  const bashSuppressed = bashSuppressedTags();
  for (const tag of selfOrigin.AGENT_ACTIONABLE_OVERRIDES) {
    assert.ok(!liveSuppressed.has(tag), `SELF_SUPPRESSED_TAG_RE must NOT suppress agent-actionable ${tag}`);
    assert.ok(!bashSuppressed.has(tag), `_self_tags.sh must NOT suppress agent-actionable ${tag}`);
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
