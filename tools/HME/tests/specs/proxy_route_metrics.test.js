'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createRouteMetrics } = require('../../proxy/proxy_route_metrics');

test('Claude proxy route metrics expose health counter shape', () => {
  const route = createRouteMetrics();
  for (const key of ['requests', 'omniroute', 'legacy_swap', 'direct', 'passthrough', 'errors', 'last_route', 'last_model', 'last_error', 'last_request_at']) {
    assert.ok(Object.prototype.hasOwnProperty.call(route.metrics, key), key);
  }
  route.recordRoute('omniroute', 'codex/gpt-5.5');
  route.recordRoute('legacy_swap', 'deepseek-v4-pro');
  route.recordError(new Error('boom'));
  assert.equal(route.metrics.requests, 2);
  assert.equal(route.metrics.omniroute, 1);
  assert.equal(route.metrics.legacy_swap, 1);
  assert.equal(route.metrics.last_route, 'legacy_swap');
  assert.equal(route.metrics.last_model, 'deepseek-v4-pro');
  assert.equal(route.metrics.errors, 1);
  assert.equal(route.metrics.last_error, 'boom');
});
