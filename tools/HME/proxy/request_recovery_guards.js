'use strict';

const fs = require('fs');
const path = require('path');
const { sessionKey } = require('./shared');
const { messageText } = require('./request_shape');

function lastUserMessageRaw(payload) {
  const msgs = payload && Array.isArray(payload.messages) ? payload.messages : null;
  if (!msgs || !msgs.length) return null;
  const last = msgs[msgs.length - 1];
  return last && last.role === 'user' ? last : null;
}

const AUTOCOMPACT_SIG_RE = /Your task is to create a detailed summary of (?:this conversation|the conversation so far)/;
function detectAutocompactRequest(payload) {
  if (!payload || !Array.isArray(payload.messages)) return false;
  const inspect = (txt) => typeof txt === 'string' && AUTOCOMPACT_SIG_RE.test(txt);
  if (typeof payload.system === 'string' && inspect(payload.system)) return true;
  if (Array.isArray(payload.system)) for (const b of payload.system) if (b && inspect(b.text)) return true;
  for (const msg of payload.messages) {
    if (!msg) continue;
    if (typeof msg.content === 'string' && inspect(msg.content)) return true;
    if (Array.isArray(msg.content)) for (const b of msg.content) if (b && b.type === 'text' && inspect(b.text)) return true;
  }
  return false;
}

function writeAutocompactLifesaver(root, payload) {
  try {
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    const ts = new Date().toISOString();
    let normLine = '';
    try {
      const sink = path.join(root, 'tools', 'HME', 'runtime', 'proxy-context-norm.json');
      normLine = ' norm=' + fs.readFileSync(sink, 'utf8').trim();
    } catch (_e) { /* best effort */ }
    const model = (payload && payload.model) || 'unknown';
    const msgCount = (payload && Array.isArray(payload.messages)) ? payload.messages.length : 0;
    const line = `[${ts}] [autocompact-fired-DESPITE-DISABLE] model=${model} messages=${msgCount}${normLine}\n`;
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'), line);
    process.stderr.write('LIFESAVER! autocompact fired despite DISABLE_AUTO_COMPACT=1 -- see log/hme-lifesaver.log\n');
    process.stderr.write(`LIFESAVER! ${line}`);
  } catch (_e) { /* best effort */ }
}

function lastUserPromptText(payload) {
  const last = lastUserMessageRaw(payload);
  return last ? messageText(last) : '';
}

const LITERAL_UNDEF_RE = /^\s*(?:<system-reminder>\s*undefined\s*<\/system-reminder>\s*)?undefined\s*$/i;
function detectAndMarkUndefinedUserPrompt(payload, root) {
  const last = lastUserMessageRaw(payload);
  if (!last) return false;
  let corrupted = false;
  const marker = '[HME LIFESAVER: upstream Claude Code corrupted user prompt to literal "undefined"; original user input lost. Do NOT treat this as user intent. Report the corruption and wait for the user to retry.]';
  if (typeof last.content === 'string' && LITERAL_UNDEF_RE.test(last.content)) {
    corrupted = true;
    last.content = marker;
  } else if (Array.isArray(last.content)) {
    for (const b of last.content) if (b && b.type === 'text' && typeof b.text === 'string' && LITERAL_UNDEF_RE.test(b.text)) {
      corrupted = true;
      b.text = marker;
    }
  }
  if (!corrupted) return false;
  try {
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'),
      `[${new Date().toISOString()}] [undefined-user-prompt] last user message body was literal "undefined"; injected marker. session=${sessionKey(payload)}\n`);
  } catch (_) { /* lifesaver log best-effort */ }
  return true;
}

const PARSE_FAIL_RE = /tool call (?:was malformed and could not|could not) be parsed|retry also failed/i;
function detectUnparsedToolCallRetry(payload, root) {
  if (!payload || !Array.isArray(payload.messages) || payload.messages.length === 0) return false;
  const blob = lastUserPromptText(payload);
  if (!blob || !PARSE_FAIL_RE.test(blob) || blob.length > 400) return false;
  payload.messages.push({ role: 'user', content: 'continue' });
  try {
    const logDir = path.join(root, 'log');
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(path.join(logDir, 'hme-lifesaver.log'),
      `[${new Date().toISOString()}] [unparsed-tool-call] parse-failure text detected as last user message; injected user "continue". session=${sessionKey(payload)}\n`);
  } catch (_) { /* best-effort */ }
  return true;
}

module.exports = { detectAutocompactRequest, writeAutocompactLifesaver, detectAndMarkUndefinedUserPrompt, detectUnparsedToolCallRetry, lastUserPromptText };
