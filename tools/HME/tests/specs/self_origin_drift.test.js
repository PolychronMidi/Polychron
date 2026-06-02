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

test('self_origin.js is a superset of the bash _self_tags.sh tag set (no drift)', () => {
  const sup = selfOriginTags();
  const missing = [...bashTags()].filter((t) => !sup.has(t));
  assert.deepEqual(missing, [], `self_origin.js missing canonical bash tags: ${missing.join(', ')}`);
});

// 22_lifesaver_inject.js (the live LIFESAVER request-path classifier) must
// CONSUME the canonical self_origin classifier rather than hand-maintaining its
test('22_lifesaver_inject consumes the canonical self_origin classifier (no private SELF_TAG_RE)', () => {
  const src = fs.readFileSync(path.join(root, 'tools/HME/proxy/middleware/22_lifesaver_inject.js'), 'utf8');
  assert.ok(/require\(['"]\.\.\/self_origin['"]\)/.test(src), '22_lifesaver_inject must require ../self_origin');
  assert.ok(/selfOrigin\.isSelfOrigin\(/.test(src), '22_lifesaver_inject must use selfOrigin.isSelfOrigin()');
  assert.ok(/selfOrigin\.isObservation\(/.test(src), '22_lifesaver_inject must use selfOrigin.isObservation()');
  assert.ok(!/const SELF_TAG_RE\s*=/.test(src), '22_lifesaver_inject must NOT redefine a private SELF_TAG_RE (drift source)');
});
