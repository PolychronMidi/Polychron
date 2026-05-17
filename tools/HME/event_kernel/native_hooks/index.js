'use strict';

const agent = require('./agent');
const diagnostics = require('./diagnostics');
const streak = require('./streak');
const todo = require('./todo');

const preToolHandlers = {
  Agent: agent.pretoolAgent,
  Glob: streak.pretoolGlob,
  TodoWrite: todo.pretoolTodoWrite,
};

const postToolHandlers = {
  Agent: agent.posttoolAgent,
  TodoWrite: todo.posttoolTodoWrite,
  Edit: diagnostics.posttoolDiagnostics,
  MultiEdit: diagnostics.posttoolDiagnostics,
  Write: diagnostics.posttoolDiagnostics,
};

module.exports = {
  ...agent,
  ...diagnostics,
  ...streak,
  ...todo,
  preToolHandlers,
  postToolHandlers,
};
