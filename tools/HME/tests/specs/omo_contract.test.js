const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadContract,
  validateOmoContract,
  validateUniversalHookContract,
} = require('../../omo_bridge/contract_validator');
const {
  PHASE_GROUPS,
  SUPPORTED_PHASES,
  UNIVERSAL_HOOK_ABI,
  validateUniversalEvent,
} = require('../../omo_bridge/universal_event');
const {
  DECISION_KINDS,
  validateUniversalDecision,
} = require('../../omo_bridge/universal_decision');

function validContract(required = ['package.json']) {
  return {
    contract_version: UNIVERSAL_HOOK_ABI,
    universal_hook_abi: {
      version: UNIVERSAL_HOOK_ABI,
      core_phases: [...PHASE_GROUPS.core],
      hme_extension_phases: [...PHASE_GROUPS.hmeExtension],
      observational_phases: [...PHASE_GROUPS.observational],
      decision_kinds: [...DECISION_KINDS],
    },
    required_entrypoints: required,
  };
}

test('OMO contract validator is safe when dependency disabled', () => {
  const result = validateOmoContract({ dependency: { enabled: false, status: 'disabled', source: 'disabled' }, contract: { contract_version: 'test/v1', required_entrypoints: ['missing'] } });
  assert.equal(result.status, 'disabled');
});

test('OMO contract validator catches missing required entrypoint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hme-omo-contract-'));
  try {
    fs.writeFileSync(path.join(root, 'package.json'), '{}');
    const result = validateOmoContract({ dependency: { enabled: true, status: 'ok', source: 'path', root }, contract: validContract(['required.js']) });
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
    const result = validateOmoContract({ dependency: { enabled: true, status: 'ok', source: 'path', root }, contract: validContract() });
    assert.equal(result.status, 'ok');
    assert.equal(result.abi_version, UNIVERSAL_HOOK_ABI);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('default OMO contract defines OpenCode-compatible universal hook ABI', () => {
  const contract = loadContract();
  const result = validateUniversalHookContract(contract);
  assert.equal(result.status, 'ok');
  assert.equal(contract.contract_version, UNIVERSAL_HOOK_ABI);
  ['chat.params', 'permission.ask', 'tool.execute.before', 'tool.execute.after'].forEach((phase) => {
    assert.ok(contract.universal_hook_abi.core_phases.includes(phase));
  });
  ['stop.before', 'stream.text_block'].forEach((phase) => {
    assert.ok(contract.universal_hook_abi.hme_extension_phases.includes(phase));
  });
});

test('universal hook contract rejects missing or unknown ABI versions', () => {
  const missing = validateUniversalHookContract({ required_entrypoints: [] });
  assert.equal(missing.status, 'error');
  assert.ok(missing.errors.some((error) => error.includes('contract_version')));
  const unknown = validateUniversalHookContract({ ...validContract(), contract_version: 'hme-opencode-hook/v2' });
  assert.equal(unknown.status, 'error');
  assert.ok(unknown.errors.some((error) => error.includes(UNIVERSAL_HOOK_ABI)));
});

test('universal hook event validator accepts supported phases and HME extensions', () => {
  assert.ok(SUPPORTED_PHASES.includes('stream.text_block'));
  const event = {
    abi: UNIVERSAL_HOOK_ABI,
    phase: 'stream.text_block',
    source: { host: 'anthropic' },
    stream: { text: 'hello' },
  };
  assert.deepEqual(validateUniversalEvent(event), { valid: true, errors: [] });
});

test('universal hook event validator rejects invalid payloads', () => {
  const missingAbi = validateUniversalEvent({ phase: 'chat.params', source: { host: 'opencode' }, chat: {} });
  assert.equal(missingAbi.valid, false);
  assert.ok(missingAbi.errors.some((error) => error.includes('abi must be')));
  const missingText = validateUniversalEvent({ abi: UNIVERSAL_HOOK_ABI, phase: 'stream.text_block', source: { host: 'anthropic' }, stream: {} });
  assert.equal(missingText.valid, false);
  assert.ok(missingText.errors.includes('stream.text_block requires stream.text'));
});

test('universal hook decision validator accepts valid decisions', () => {
  assert.deepEqual(validateUniversalDecision({ kind: 'deny', reason: 'blocked' }), { valid: true, errors: [] });
  assert.deepEqual(validateUniversalDecision({ kind: 'modify', target: 'chat.params', patch: { max_tokens: 1024 } }), { valid: true, errors: [] });
});

test('universal hook decision validator rejects invalid decisions', () => {
  const missingReason = validateUniversalDecision({ kind: 'deny' });
  assert.equal(missingReason.valid, false);
  assert.ok(missingReason.errors.includes('deny requires reason'));
  const unknownKind = validateUniversalDecision({ kind: 'teleport' });
  assert.equal(unknownKind.valid, false);
  assert.ok(unknownKind.errors.some((error) => error.includes('kind must be one of')));
});
