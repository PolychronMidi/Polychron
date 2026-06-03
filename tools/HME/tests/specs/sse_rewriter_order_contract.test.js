'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const _fs = require('node:fs');
const _path = require('node:path');
const { requireEnv } = require('../../proxy/shared/load_env');

const root = requireEnv('PROJECT_ROOT');
const sourcePath = _path.join(root, 'tools/HME/proxy/hme_proxy_response_send.js');

function rewriterArraySource() {
  const src = _fs.readFileSync(sourcePath, 'utf8');
  const m = /rewriters:\s*\[([\s\S]*?)\n\s*\],\s*\n\s*}\);/.exec(src);
  assert.ok(m, 'hme_proxy_response_send.js must instantiate SseTransform with an inline rewriters array');
  return m[1];
}

function orderedLabels() {
  const body = rewriterArraySource();
  const labels = [];
  const re = /(dropToolUseRewrite|editFallbackToReadRewrite|readInputNormalizeRewrite|providerReasoningToThinkingRewrite|asciiStripRewrite|bashPolicyRewrite|longLeadingSleepRewrite|runInBackgroundRewrite|slopStripRewrite)|stopHookRewritersForSlot\('([^']+)'\)/g;
  let m;
  while ((m = re.exec(body))) labels.push(m[1] || `stop:${m[2]}`);
  return labels;
}

test('SSE response rewriter order is pinned: structural/tool rewrites, stop-hook pre-slop, slop, stop-hook post-slop', () => {
  assert.deepEqual(orderedLabels(), [
    'dropToolUseRewrite',
    'editFallbackToReadRewrite',
    'readInputNormalizeRewrite',
    'providerReasoningToThinkingRewrite',
    'asciiStripRewrite',
    'stop:pre-tool',
    'bashPolicyRewrite',
    'longLeadingSleepRewrite',
    'runInBackgroundRewrite',
    'stop:post-tool-pre-slop',
    'slopStripRewrite',
    'stop:post-slop',
  ]);
});
