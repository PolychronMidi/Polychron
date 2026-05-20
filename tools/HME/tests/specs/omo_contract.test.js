'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { validateOmoContract } = require('../../omo_bridge/contract_validator');

test('OMO contract validator is safe when dependency disabled', () => {
  const result = validateOmoContract({ dependency: { enabled: false, status: 'disabled', source: 'disabled' }, contract: { contract_version: 'test/v1', required_entrypoints: ['missing'] } });
  assert.equal(result.status, 'disabled');
});

test('OMO contract validator catches missing required entrypoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-omo-contract-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const result = validateOmoContract({ dependency: { enabled: true, status: 'ok', source: 'path', root }, contract: { contract_version: 'test/v1', required_entrypoints: ['required.js'] } });
    assert.equal(result.status, 'error');
    assert.deepEqual(result.missing, ['required.js']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('OMO contract validator passes when required entrypoint exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-omo-contract-ok-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const result = validateOmoContract({ dependency: { enabled: true, status: 'ok', source: 'path', root }, contract: { contract_version: 'test/v1', required_entrypoints: ['package.json'] } });
    assert.equal(result.status, 'ok');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
