'use strict';

const { injectNativeToolSchemas } = require('./codex_native_tools');
const core = require('./request_transform_core');

function applyRequestTransform(body, deps) {
  return core.applyCodexRequestTransform(body, deps, injectNativeToolSchemas);
}

module.exports = {
  applyRequestTransform,
  requestStats: core.requestStats,
  toolName: core.toolName,
};
