'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { resolveOmo } = require('./dependency');
const { validateOmoContract } = require('./contract_validator');
const { emitOmo } = require('./telemetry');

function _hookShape(plugin) {
  if (!plugin || typeof plugin !== 'object') return [];
  return Object.keys(plugin).filter((k) => typeof plugin[k] === 'function').sort();
}
async function evaluateOmoCheckout(options = {}) {
  const telemetry = options.telemetry;
  const dep = resolveOmo({ ...options, telemetry });
  const contract = validateOmoContract({ dependency: dep, strict: false, telemetry });
  const result = {
    dependency: dep,
    contract: { status: contract.status, missing: contract.missing || [], contract_version: contract.contract_version },
    import_status: 'skipped',
    hook_shape: [],
  };
  if (dep.status === 'ok' && options.loadEntrypoint === true && dep.entrypoint) {
    try {
      const entry = path.join(dep.root, dep.entrypoint);
      let mod;
      try { mod = require(entry); }
      catch (err) {
        if (err && err.code !== 'ERR_REQUIRE_ESM') throw err;
        mod = await import(pathToFileURL(entry).href);
      }
      const plugin = mod && (mod.default || mod.plugin || mod);
      result.import_status = 'ok';
      result.hook_shape = _hookShape(plugin);
    } catch (err) {
      result.import_status = 'error';
      result.import_error = err.message;
    }
  }
  emitOmo('omo_checkout_evaluated', { source: dep.source, status: dep.status, contract_status: contract.status, import_status: result.import_status, hooks: result.hook_shape.join(',') }, telemetry);
  return result;
}
module.exports = { evaluateOmoCheckout };
