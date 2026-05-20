'use strict';
function toOpenCodePluginInput(event = {}, options = {}) {
  return {
    directory: options.directory || process.cwd(),
    client: options.client,
    sessionID: event.session_id || event.sessionId || 'unknown',
    messages: event.messages || (event.payload && event.payload.messages) || [],
    model: event.model || (event.payload && event.payload.model) || '',
    metadata: { hme_event: event.event || event.type || '', route: event.route || '' },
  };
}
const HOOK_MAP = {
  request: ['chat.params', 'chat.headers', 'chat.message', 'experimental.chat.messages.transform', 'experimental.chat.system.transform'],
  pretool: ['tool.execute.before'],
  posttool: ['tool.execute.after'],
  compacting: ['experimental.session.compacting'],
  autocontinue: ['experimental.compaction.autocontinue'],
};
module.exports = { toOpenCodePluginInput, HOOK_MAP };
