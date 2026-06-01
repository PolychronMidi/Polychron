const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../proxy/shared');
const { resolveOmo, _entryExists } = require('./dependency');
const { emitOmo } = require('./telemetry');
const { PHASE_GROUPS, UNIVERSAL_HOOK_ABI, isPlainObject } = require('./universal_event');
const { DECISION_KINDS } = require('./universal_decision');

const DEFAULT_CONTRACT = path.join(__dirname, 'contract.json');

function loadContract(contractPath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}

function missingValues(actual, required) {
  const values = Array.isArray(actual) ? actual : [];
  return required.filter((value) => !values.includes(value));
}

function validateUniversalHookContract(contract = {}) {
  const errors = [];
  if (!isPlainObject(contract)) return { status: 'error', errors: ['contract must be an object'], abi_version: '' };
  const abi = contract.universal_hook_abi;
  if (contract.contract_version !== UNIVERSAL_HOOK_ABI) errors.push(`contract_version must be ${UNIVERSAL_HOOK_ABI}`);
  if (!isPlainObject(abi)) {
    errors.push('universal_hook_abi must be an object');
    return { status: 'error', errors, abi_version: '' };
  }
  if (abi.version !== UNIVERSAL_HOOK_ABI) errors.push(`universal_hook_abi.version must be ${UNIVERSAL_HOOK_ABI}`);
  const missingCore = missingValues(abi.core_phases, PHASE_GROUPS.core);
  const missingExtensions = missingValues(abi.hme_extension_phases, PHASE_GROUPS.hmeExtension);
  const missingDecisions = missingValues(abi.decision_kinds, DECISION_KINDS);
  if (missingCore.length) errors.push(`universal_hook_abi.core_phases missing: ${missingCore.join(', ')}`);
  if (missingExtensions.length) errors.push(`universal_hook_abi.hme_extension_phases missing: ${missingExtensions.join(', ')}`);
  if (missingDecisions.length) errors.push(`universal_hook_abi.decision_kinds missing: ${missingDecisions.join(', ')}`);
  return { status: errors.length ? 'error' : 'ok', errors, abi_version: abi.version || '' };
}

function emitValidation(result, dep, telemetry) {
  emitOmo('omo_contract_validated', {
    status: result.status,
    missing: (result.missing || []).join(','),
    contract_errors: (result.contract_errors || []).join(';'),
    contract_version: result.contract_version,
    source: dep.source,
    version: dep.version,
    commit: dep.commit,
    root: dep.root ? path.relative(PROJECT_ROOT, dep.root) || '.' : '',
  }, telemetry);
}

function validateOmoContract(options = {}) {
  const telemetry = options.telemetry;
  const dep = options.dependency || resolveOmo({ ...options, telemetry });
  const contract = options.contract || loadContract(options.contractPath);
  const contract_version = contract.contract_version;
  if (!dep.enabled || dep.status === 'disabled') {
    const result = { status: 'disabled', dependency: dep, missing: [], contract_version };
    emitOmo('omo_contract_validated', { status: result.status, contract_version }, telemetry);
    return result;
  }
  if (dep.status !== 'ok') {
    const result = { status: 'error', dependency: dep, missing: [], error: dep.error, contract_version };
    emitOmo('omo_contract_validated', { status: result.status, error: result.error, contract_version }, telemetry);
    return result;
  }
  const abi = validateUniversalHookContract(contract);
  if (abi.status !== 'ok') {
    const result = { status: 'error', dependency: dep, missing: [], contract_errors: abi.errors, contract_version, abi_version: abi.abi_version };
    emitValidation(result, dep, telemetry);
    if (options.strict) throw new Error(`OMO contract invalid: ${abi.errors.join('; ')}`);
    return result;
  }
  const required = Array.isArray(contract.required_entrypoints) ? contract.required_entrypoints : [];
  const missing = required.filter((entry) => !_entryExists(dep.root, entry));
  const status = missing.length ? 'error' : 'ok';
  const result = { status, dependency: dep, missing, contract_version, abi_version: abi.abi_version };
  emitValidation(result, dep, telemetry);
  if (missing.length && options.strict) throw new Error(`OMO contract missing required entrypoint(s): ${missing.join(', ')}`);
  return result;
}

module.exports = { loadContract, validateOmoContract, validateUniversalHookContract };
