'use strict';
function createClientShim(options = {}) {
  const sessions = options.sessions || new Map();
  return {
    session: {
      async get(id) { return sessions.get(id) || { id, messages: [] }; },
      async set(id, value) { if (options.allowMutations !== true) throw new Error('OMO client session mutation requires HME policy'); sessions.set(id, value); return value; },
    },
    tools: options.tools || [],
  };
}
module.exports = { createClientShim };
