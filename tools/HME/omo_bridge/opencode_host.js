'use strict';
const { createClientShim } = require('./client_shim');
const { toOpenCodePluginInput, HOOK_MAP } = require('./lifecycle_map');
const { invokeOmoHook } = require('./hook_adapter');
async function createOpenCodeHost(pluginFactory, options = {}) {
  const client = options.client || createClientShim(options);
  const plugin = typeof pluginFactory === 'function'
    ? await pluginFactory({ directory: options.directory || process.cwd(), client })
    : (pluginFactory && typeof pluginFactory.server === 'function'
      ? await pluginFactory.server({ directory: options.directory || process.cwd(), client })
      : (pluginFactory || {}));
  return {
    plugin,
    client,
    async invoke(lifecycle, event, invokeOptions = {}) {
      const input = toOpenCodePluginInput(event, { ...options, client });
      const hooks = HOOK_MAP[lifecycle] || [lifecycle];
      const results = [];
      for (const hookName of hooks) {
        results.push(await invokeOmoHook(hookName, input, { ...options, ...invokeOptions, hooks: plugin, enabled: invokeOptions.enabled ?? options.enabled }));
      }
      return results;
    },
  };
}
module.exports = { createOpenCodeHost };
