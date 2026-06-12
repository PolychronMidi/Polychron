'use strict';
function _sessionId(arg) {
  if (typeof arg === 'string') return arg;
  return arg && arg.path && arg.path.id || arg && arg.id || 'unknown';
}
function _asSdkData(value) { return value && value.data !== undefined ? value : { data: value }; }
function createClientShim(options = {}) {
  const sessions = options.sessions || new Map();
  const read = (id) => sessions.get(id) || { id, messages: [], todos: [] };
  return {
    session: {
      async get(arg) { return _asSdkData(read(_sessionId(arg))); },
      async messages(arg) { return _asSdkData(read(_sessionId(arg)).messages || []); },
      async message(arg) {
        const sid = _sessionId(arg);
        const messageID = arg && arg.path && arg.path.messageID || arg && arg.messageID;
        const found = (read(sid).messages || []).find((m) => m && (m.id === messageID || (m.info && m.info.id === messageID)));
        return _asSdkData(found || { id: messageID || '', parts: [] });
      },
      async todo(arg) { return _asSdkData(read(_sessionId(arg)).todos || []); },
      async status() { return _asSdkData({ status: 'idle' }); },
      async set(id, value) { if (options.allowMutations !== true) throw new Error('OMO client session mutation requires HME policy'); sessions.set(id, value); return value; },
      async abort() { if (options.allowMutations !== true) throw new Error('OMO client session abort requires HME policy'); return _asSdkData({ ok: true }); },
      async promptAsync() { if (options.allowMutations !== true) throw new Error('OMO client promptAsync requires HME policy'); return _asSdkData({ ok: true }); },
      async summarize() { if (options.allowMutations !== true) throw new Error('OMO client summarize requires HME policy'); return _asSdkData({ ok: true }); },
    },
    provider: { async list() { return _asSdkData([]); } },
    tui: { async showToast() { return _asSdkData({ ok: true }); } },
    tools: options.tools || [],
  };
}
module.exports = { createClientShim };
