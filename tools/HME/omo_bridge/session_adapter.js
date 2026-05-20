'use strict';
const { emitOmo } = require('./telemetry');
async function getOmoSessionSnapshot(sessionId, options = {}) {
  let snapshot = { todos: [], tasks: [], agents: [], background_jobs: [], team_status: null, context_entries: [] };
  let source = 'disabled';
  if (options.omo && options.omo.session && typeof options.omo.session.snapshot === 'function') {
    source = 'omo';
    snapshot = { ...snapshot, ...(await options.omo.session.snapshot(sessionId)) };
  }
  emitOmo('omo_session_snapshot', { session_id: String(sessionId || 'unknown'), source, todos: (snapshot.todos || []).length, tasks: (snapshot.tasks || []).length }, options.telemetry);
  return { source, snapshot };
}
module.exports = { getOmoSessionSnapshot };
