'use strict';

const agent = require('./agent');
const diagnostics = require('./diagnostics');
// Native TodoWrite mirror retired: TODO.md is now the single source of truth
// via the standalone todo_engine. No native-tool interception/mirroring.

const preToolHandlers = {
  Agent: agent.pretoolAgent,
};

const postToolHandlers = {
  Agent: agent.posttoolAgent,
  Edit: diagnostics.posttoolDiagnostics,
  MultiEdit: diagnostics.posttoolDiagnostics,
  Write: diagnostics.posttoolDiagnostics,
};

module.exports = {
  ...agent,
  ...diagnostics,
  preToolHandlers,
  postToolHandlers,
};
