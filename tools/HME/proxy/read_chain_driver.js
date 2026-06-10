'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const readChain = require('./read_chain');

function _lastUserText(payload) {
  const messages = Array.isArray(payload && payload.messages) ? payload.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) return m.content.filter((b) => b && b.type === 'text').map((b) => b.text || '').join('\n');
    return '';
  }
  return '';
}

function _consumeConsultReadQueue() {
  const marker = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'latest-consult-read-queue.json');
  try {
    const data = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (!data || data.consumed === true) return null;
    const expires = Date.parse(String(data.expires_at || ''));
    if (!Number.isFinite(expires) || Date.now() > expires) return null;
    const files = Array.isArray(data.native_read_before_report) ? data.native_read_before_report.map(String).filter(Boolean) : [];
    if (!files.length) return null;
    fs.writeFileSync(marker, JSON.stringify({ ...data, consumed: true, consumed_at: new Date().toISOString() }, null, 2) + '\n');
    return files.map((f) => (path.isAbsolute(f) ? f : path.join(PROJECT_ROOT, f)));
  } catch (_e) { return null; }
}

function _startFromTaskNotification(payload) {
  const text = _lastUserText(payload);
  if (!/<task-notification>[\s\S]*<status>completed<\/status>[\s\S]*<\/task-notification>/i.test(text)) return null;
  return _consumeConsultReadQueue();
}

function maybeDriveReadChain({ clientRes, payload }) {
  if (!payload) return false;
  let files = null;
  let nextIndex = 0;
  const cont = readChain.nextStepFromToolResult(payload);
  if (cont) {
    files = cont.files;
    nextIndex = cont.nextIndex;
  } else {
    const start = readChain.startFilesFromTrigger(payload);
    if (!start) return false;
    files = start;
    nextIndex = 0;
  }
  const model = (payload && payload.model) || 'claude-read-chain';
  const body = readChain.buildReadToolUseMessage(files, nextIndex, { model })
    || readChain.buildDoneMessage(files.length, { model });
  if (payload && payload.stream === true) {
    const sse = Buffer.from(readChain.toAnthropicSse(body), 'utf8');
    clientRes.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    clientRes.end(sse);
    return true;
  }
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  clientRes.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(json.length) });
  clientRes.end(json);
  return true;
}

module.exports = { maybeDriveReadChain };
