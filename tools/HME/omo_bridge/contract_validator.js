'use strict';
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('../proxy/shared');
const { resolveOmo, _entryExists } = require('./dependency');
const { emitOmo } = require('./telemetry');

const DEFAULT_CONTRACT = path.join(__dirname, 'contract.json');
function loadContract(contractPath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(contractPath, 'utf8'));
}
function validateOmoContract(options = {}) {
  const telemetry = options.telemetry;
  const dep = options.dependency || resolveOmo({ ...options, telemetry });
  const contract = options.contract || loadContract(options.contractPath);
  if (!dep.enabled || dep.status === 'disabled') {
    const result = { status: 'disabled', dependency: dep, missing: [], contract_version: contract.contract_version };
    emitOmo('omo_contract_validated', { status: result.status, contract_version: result.contract_version }, telemetry);
    return result;
  }
  if (dep.status !== 'ok') {
    const result = { status: 'error', dependency: dep, missing: [], error: dep.error, contract_version: contract.contract_version };
    emitOmo('omo_contract_validated', { status: result.status, error: result.error, contract_version: result.contract_version }, telemetry);
    return result;
  }
  const required = Array.isArray(contract.required_entrypoints) ? contract.required_entrypoints : [];
  const missing = required.filter((entry) => !_entryExists(dep.root, entry));
  const status = missing.length ? 'error' : 'ok';
  const result = { status, dependency: dep, missing, contract_version: contract.contract_version };
  emitOmo('omo_contract_validated', {
    status,
    missing: missing.join(','),
    contract_version: contract.contract_version,
    source: dep.source,
    version: dep.version,
    commit: dep.commit,
    root: dep.root ? path.relative(PROJECT_ROOT, dep.root) || '.' : '',
  }, telemetry);
  if (missing.length && options.strict) throw new Error(`OMO contract missing required entrypoint(s): ${missing.join(', ')}`);
  return result;
}

module.exports = { loadContract, validateOmoContract };
