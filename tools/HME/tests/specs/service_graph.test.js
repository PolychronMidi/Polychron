'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const services = require('../../proxy/service_registry');
const { CHILDREN } = require('../../proxy/supervisor/children');

test('proxy supervisor children derive graph-critical facts from services.json', () => {
  const supervised = services.supervisedChildren('proxy').map((s) => s.id).sort();
  const childNames = CHILDREN.map((c) => c.name).sort();
  assert.deepEqual(childNames, supervised);

  for (const child of CHILDREN) {
    const svc = services.service(child.name);
    assert.equal(child.healthUrl, services.serviceUrl(child.name));
    assert.equal(child.required, svc.required !== false);
  }
});

test('service graph exposes proxy bundle process labels without hardcoded callers', () => {
  const labels = services.bundlePidLabels('proxy');
  assert.ok(labels.includes('proxy'));
  assert.ok(labels.includes('worker'));
  assert.ok(labels.includes('llamacpp_daemon'));
  const patterns = services.bundleProcessPatterns('proxy');
  assert.ok(patterns.includes('hme_proxy.js'));
  assert.ok(patterns.includes('worker.py'));
});
