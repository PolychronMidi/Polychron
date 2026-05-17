'use strict';

const agent = require('./agent');
const diagnostics = require('./diagnostics');
const todo = require('./todo');

const preToolHandlers = {
  Agent: agent.pretoolAgent,
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
  ...todo,
  preToolHandlers,
  postToolHandlers,
};
