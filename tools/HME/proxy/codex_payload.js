'use strict';

const core = require('./request_transform_core');

function applyRequestTransform(body, _deps) {
  const stats = core.requestStats(body);
  return { body, before: stats, after: stats, cleanup: {}, payload_log: null };
}

module.exports = {
  applyRequestTransform,
  requestStats: core.requestStats,
  toolName: core.toolName,
};
