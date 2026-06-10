'use strict';

const readChain = require('./read_chain');

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
