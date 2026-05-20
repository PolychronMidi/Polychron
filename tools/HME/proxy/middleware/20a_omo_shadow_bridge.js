'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
const { PROJECT_ROOT } = require('../shared');
const { resolveOmo } = require('../../omo_bridge/dependency');
const { validateOmoContract } = require('../../omo_bridge/contract_validator');
const { hmeToolsForOmo } = require('../../omo_bridge/hme_tools_to_omo');
const { createOpenCodeHost } = require('../../omo_bridge/opencode_host');

let _loadedPlugin = null;
let _loadedKey = '';

async function _loadPlugin(dep) {
  if (!dep || dep.status !== 'ok' || !dep.root || !dep.entrypoint) return null;
  const key = `${dep.root}:${dep.entrypoint}`;
  if (_loadedKey === key) return _loadedPlugin;
  _loadedKey = key;
  const entry = path.join(dep.root, dep.entrypoint);
  let mod;
  try { mod = require(entry); }
  catch (err) {
    if (err && err.code !== 'ERR_REQUIRE_ESM') throw err;
    mod = await import(pathToFileURL(entry).href);
  }
  _loadedPlugin = mod && (mod.default || mod.plugin || mod);
  return _loadedPlugin;
}

module.exports = {
  name: 'omo_shadow_bridge',

  async onRequest({ payload, session, ctx }) {
    if (process.env.HME_OMO_ENABLED !== '1') return;
    const telemetry = ctx && ctx.emit;
    const dep = resolveOmo({
      enabled: process.env.HME_OMO_ENABLED === '1',
      source: process.env.HME_OMO_SOURCE,
      path: process.env.HME_OMO_PATH,
      packageName: process.env.HME_OMO_PACKAGE,
      telemetry,
    });
    const contract = validateOmoContract({ dependency: dep, strict: process.env.HME_OMO_STRICT_CONTRACT === '1', telemetry });
    if (contract.status !== 'ok') return;
    if (process.env.HME_OMO_TOOL_BRIDGE === '1') hmeToolsForOmo({ telemetry });
    if (process.env.HME_OMO_HOOK_BRIDGE !== '1') return;
    try {
      const plugin = _loadPlugin(dep);
      if (!plugin) return;
      const host = await createOpenCodeHost(plugin, {
        enabled: true,
        directory: PROJECT_ROOT,
        allowMutations: false,
        telemetry,
      });
      await host.invoke('request', { event: 'request', session_id: session, payload }, {
        enabled: true,
        allowMutations: false,
        maxBytes: 8192,
        telemetry,
      });
    } catch (err) {
      if (telemetry) telemetry({ event: 'omo_bridge_error', bridge: 'shadow_middleware', error: err.message });
    }
  },
};
