'use strict';

const fs = require('fs');
const path = require('path');
const {
  isSingleQuotaProbe,
  isTodoWriteOnlyProbe,
  isStructuredOutputsProbe,
  shouldBlockNoopSystemReminderTurn,
  blockQuotaProbe,
  blockTodoWriteOnlyProbe,
  blockStructuredOutputsProbe,
  blockNoopSystemReminderTurn,
} = require('./contexts/request_mutation');

function writeTmpPayload(prefix, clientReq, payload) {
  const root = process.env.PROJECT_ROOT;
  if (!root) throw new Error('PROJECT_ROOT not set');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const body = { url: clientReq.url, headers: clientReq.headers, payload };
  fs.writeFileSync(path.join(root, 'tmp', `${prefix}-${ts}.json`), JSON.stringify(body, null, 2));
}

function maybeBlockEarlyClaudeRequest({ clientReq, clientRes, payload }) {
  if (isSingleQuotaProbe(payload)) {
    blockQuotaProbe({ res: clientRes, payload });
    return true;
  }
  if (shouldBlockNoopSystemReminderTurn({ req: clientReq, payload, headers: clientReq.headers })) {
    try { writeTmpPayload('noop-block', clientReq, payload); } catch (_e) { /* best effort */ }
    blockNoopSystemReminderTurn({ req: clientReq, res: clientRes, payload });
    return true;
  }
  return false;
}

function captureNoopReminderLeak({ clientReq, payload }) {
  try {
    const messages = payload && payload.messages || [];
    const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
    if (!lastUser) return;
    const blocks = Array.isArray(lastUser.content) ? lastUser.content : [];
    const allText = blocks
      .map((b) => (b && typeof b === 'object' && typeof b.text === 'string') ? b.text : '')
      .join('\n');
    if (!/<system-reminder>/i.test(allText)) return;
    const stripped = allText.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
    if (stripped !== '' && stripped.length >= 4) return;
    writeTmpPayload('noop-leak', clientReq, payload);
  } catch (_e) { /* best effort */ }
}

function maybeBlockLateClaudeProbeRequest({ clientReq, clientRes, payload }) {
  if (isStructuredOutputsProbe(payload, clientReq.headers)) {
    blockStructuredOutputsProbe({ res: clientRes, payload });
    return true;
  }
  if (isTodoWriteOnlyProbe(payload)) {
    blockTodoWriteOnlyProbe({ res: clientRes, payload });
    return true;
  }
  return false;
}

module.exports = {
  captureNoopReminderLeak,
  maybeBlockEarlyClaudeRequest,
  maybeBlockLateClaudeProbeRequest,
};
