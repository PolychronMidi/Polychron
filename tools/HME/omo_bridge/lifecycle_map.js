'use strict';
function _openCodeMessages(messages = [], sessionID = 'unknown', model = '') {
  return (Array.isArray(messages) ? messages : []).map((m, i) => {
    const id = m.id || `hme_${sessionID}_${i}`;
    const text = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
    return {
      info: { id, sessionID, role: m.role || 'user', time: { created: Date.now() }, agent: 'hme', model: { providerID: 'hme', modelID: String(model || 'unknown') } },
      parts: [{ id: `${id}_text`, sessionID, messageID: id, type: 'text', text }],
    };
  });
}
function toOpenCodePluginInput(event = {}, options = {}) {
  const payload = event.payload || {};
  const sessionID = event.session_id || event.sessionId || 'unknown';
  const modelID = String(event.model || payload.model || '');
  const providerID = String(event.provider || payload.provider || 'hme');
  const last = Array.isArray(payload.messages) ? payload.messages[payload.messages.length - 1] : null;
  return {
    directory: options.directory || process.cwd(),
    client: options.client,
    sessionID,
    agent: event.agent || 'hme',
    model: { providerID, modelID },
    provider: { id: providerID },
    message: { id: `hme_${sessionID}_message`, role: last && last.role || 'user', model: { providerID, modelID } },
    messages: _openCodeMessages(event.messages || payload.messages || [], sessionID, modelID),
    metadata: { hme_event: event.event || event.type || '', route: event.route || '' },
  };
}
const HOOK_MAP = {
  request: ['chat.params', 'chat.headers', 'experimental.chat.messages.transform', 'experimental.chat.system.transform'],
  pretool: ['tool.execute.before'],
  posttool: ['tool.execute.after'],
  compacting: ['experimental.session.compacting'],
  autocontinue: ['experimental.compaction.autocontinue'],
};
module.exports = { toOpenCodePluginInput, HOOK_MAP };
