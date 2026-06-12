'use strict';
const { emitOmo } = require('./telemetry');
async function getOmoSessionSnapshot(sessionId, options = {}) {
  let snapshot = { todos: [], tasks: [], agents: [], background_jobs: [], team_status: null, context_entries: [], messages: [] };
  let source = 'disabled';
  if (options.omo && options.omo.session && typeof options.omo.session.snapshot === 'function') {
    source = 'omo';
    snapshot = { ...snapshot, ...(await options.omo.session.snapshot(sessionId)) };
  } else if (options.client && options.client.session) {
    source = 'client';
    const path = { id: sessionId };
    const [session, messages, todos] = await Promise.all([
      typeof options.client.session.get === 'function' ? options.client.session.get({ path }).catch(() => null) : null,
      typeof options.client.session.messages === 'function' ? options.client.session.messages({ path }).catch(() => null) : null,
      typeof options.client.session.todo === 'function' ? options.client.session.todo({ path }).catch(() => null) : null,
    ]);
    snapshot = {
      ...snapshot,
      ...(session && session.data && typeof session.data === 'object' ? session.data : {}),
      messages: messages && Array.isArray(messages.data) ? messages.data : [],
      todos: todos && Array.isArray(todos.data) ? todos.data : [],
    };
  }
  emitOmo('omo_session_snapshot', { session_id: String(sessionId || 'unknown'), source, todos: (snapshot.todos || []).length, tasks: (snapshot.tasks || []).length, messages: (snapshot.messages || []).length }, options.telemetry);
  return { source, snapshot };
}
module.exports = { getOmoSessionSnapshot };
