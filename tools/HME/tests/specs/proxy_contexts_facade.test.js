'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Each entry: context dir + the exports the façade must expose. These
// are the public surfaces declared in doc/PROXY_CONTEXTS.md. If any

const CONTEXTS = {
  request_mutation: ['mutateClaudeRequest', 'applyExplicitOtpmCap'],
  upstream_dispatch: ['createClaudeHandler'],
  response_transform: [
    'handleAnthropicResponseComplete',
    'captureRateLimitTelemetry',
    'emitContextTokenUsage',
    'normalizeOmniContextWindowSse',
    'retryOmniContextWindowExceeded',
  ],
  lifecycle_bridge: [
    'handleLifecycleRoute',
    'recordLifecycleHit',
    'lifecycleInactive',
    'runInlineFallback',
  ],
  failure_policy: [
    'classifyFailure',
    'policyFor',
    'actionsFor',
    'POLICY_TABLE',
    'handleUpstreamFailureOrSuccess',
    'recordSuccessAndReset',
    'recordOmniRouteFailureAdvance',
    'retryBlankOmniRouteResponse',
    'blankRetryDisabledReason',
    'detectUpstreamFailure',
    'alertCooldownActive',
    'handleMidResponseError',
    'handleConnectionError',
    'markRouteCooldown',
    'loadModelRouteHealth',
    'routeSkipReason',
  ],
};

for (const [name, exports] of Object.entries(CONTEXTS)) {
  test(`proxy/contexts/${name}/ façade exposes documented exports`, () => {
    const ctx = require(path.resolve(__dirname,
      '..', '..', 'proxy', 'contexts', name));
    for (const key of exports) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(ctx, key),
        `${name}: missing export ${key}`,
      );
      assert.ok(
        ctx[key] !== undefined,
        `${name}: export ${key} is undefined (source module dropped it?)`,
      );
    }
  });
}
