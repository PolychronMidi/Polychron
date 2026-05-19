'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { PROJECT_ROOT } = require('./shared');

const TOOL_NAMES = new Set(['Read', 'Edit', 'Write', 'WebFetch', 'Agent', 'Bash']);
const ACTIONS = { Read: 'read', Edit: 'edit', Write: 'write', WebFetch: 'web_fetch', Agent: 'agent' };
const MAX_OUTPUT = 200000;
const EMPTY_BASH_TOOL_RESULT = [
  'HME adapter notice: ignored an empty Bash tool call because no command was provided.',
  'This notice is not task context and should not be treated as the user request.',
  'Continue from the latest user request/session objective; do not ask the user to resend context solely because of this adapter notice.',
].join('\n');

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch (_e) { return {}; }
}

function callName(obj) {
  if (!obj || typeof obj !== 'object') return '';
  return typeof obj.name === 'string' ? obj.name : '';
}

function callArgs(obj) {
  if (!obj || typeof obj !== 'object') return {};
  if (obj.arguments != null) return parseArgs(obj.arguments);
  if (obj.input && typeof obj.input === 'object') return obj.input;
  return {};
}

function callId(obj) {
  return obj && (obj.call_id || obj.id || obj.item_id) || '';
}

function collectFromValue(value, out, seen) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const item of value) collectFromValue(item, out, seen); return; }
  const name = callName(value);
  const id = callId(value);
  if (value.type === 'function_call' && TOOL_NAMES.has(name) && id && !seen.has(id)) {
    seen.add(id);
    out.push({ id, name, args: callArgs(value) });
    return;
  }
  for (const child of Object.values(value)) collectFromValue(child, out, seen);
}

function collectToolCalls(body) {
  const out = [];
  collectFromValue(body, out, new Set());
  return out;
}

function parseSseEvents(text) {
  const events = [];
  for (const raw of String(text || '').split(/\r?\n\r?\n/)) {
    const data = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    try { events.push(JSON.parse(data)); } catch (_e) { /* malformed passthrough */ }
  }
  return events;
}

function collectSseToolCalls(text) {
  const calls = [];
  const seen = new Set();
  for (const event of parseSseEvents(text)) {
    if (event && event.item && event.item.type === 'function_call') collectFromValue(event.item, calls, seen);
    else if (event && event.type === 'response.output_item.done') collectFromValue(event, calls, seen);
  }
  return calls;
}

function responseId(body, events = []) {
  if (body && typeof body === 'object') return body.id || body.response_id || body.response?.id || '';
  for (const event of events) {
    if (event.response && event.response.id) return event.response.id;
    if (event.item && event.item.response_id) return event.item.response_id;
    if (event.id && String(event.type || '').startsWith('response.')) return event.id;
  }
  return '';
}

function inputFor(name, args) {
  if (name === 'Read') {
    const out = { file_path: args.file_path || args.file || '' };
    if (args.offset != null) out.offset = Number(args.offset);
    if (args.limit != null) out.limit = Number(args.limit);
    if (args.tail != null) out.tail = Number(args.tail);
    if (args.pages) out.pages = String(args.pages);
    return out;
  }
  if (name === 'Write') return { file_path: args.file_path || args.file || '', content: String(args.content || '') };
  if (name === 'Edit') return { file_path: args.file_path || args.file || '', old_string: String(args.old_string || ''), new_string: String(args.new_string || ''), ...(args.replace_all ? { replace_all: true } : {}) };
  if (name === 'WebFetch') return { url: String(args.url || ''), prompt: String(args.prompt || '') };
  if (name === 'Agent') return { prompt: String(args.prompt || ''), ...(args.level != null ? { level: Number(args.level) } : {}) };
  return args;
}

function runNodeTool(name, args, root) {
  const script = path.join(root, 'tools', 'HME', 'scripts', 'codex_structured_tool.js');
  const input = JSON.stringify(inputFor(name, args));
  return spawnSync(process.execPath, [script, ACTIONS[name], '--json'], { cwd: root, input, encoding: 'utf8', timeout: 120000, env: { ...process.env, PROJECT_ROOT: root } });
}

function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

function bashCommand(args, root) {
  const command = String(args.command || args.cmd || '');
  const verdict = evaluateBashInput({ command }, { projectRoot: root, supportsRunInBackground: false });
  if (verdict && verdict.decision === 'deny') return blockedCommand(verdict.reason || 'blocked');
  return verdict && verdict.input ? String(verdict.input.command || verdict.input.cmd || command) : command;
}

function runBash(args, root) {
  const cmd = bashCommand(args, root);
  if (!cmd.trim()) return { status: 2, stdout: EMPTY_BASH_TOOL_RESULT, stderr: '', hmeAdapterNotice: 'empty_bash_command' };
  const timeout = Math.min(Math.max(Number(args.timeout || args.timeout_ms || 120000), 1), 600000);
  return spawnSync('bash', ['-lc', cmd], { cwd: root, encoding: 'utf8', timeout, env: { ...process.env, PROJECT_ROOT: root } });
}

function outputOf(result) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const text = result.status === 0 ? stdout : `${stdout}${stderr ? (stdout ? '\n' : '') + stderr : ''}`;
  return (text || (result.error ? String(result.error.message || result.error) : '')).slice(0, MAX_OUTPUT);
}

function isIncompleteToolCall(call) {
  if (!call || call.name !== 'Bash') return false;
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  return !String(args.command || args.cmd || '').trim();
}

function executeToolCall(call, opts = {}) {
  const root = opts.projectRoot || PROJECT_ROOT;
  const result = call.name === 'Bash' ? runBash(call.args, root) : runNodeTool(call.name, call.args, root);
  return { type: 'function_call_output', call_id: call.id, output: outputOf(result) };
}

function toolResultInput(calls, opts = {}) {
  return calls.map((call) => executeToolCall(call, opts));
}

function followupBody(previousBody, responseBody, toolOutputs, events = []) {
  const id = responseId(responseBody, events);
  const body = { ...previousBody, input: toolOutputs };
  if (id) body.previous_response_id = id;
  return body;
}

module.exports = { collectToolCalls, collectSseToolCalls, parseSseEvents, toolResultInput, followupBody, isIncompleteToolCall, EMPTY_BASH_TOOL_RESULT };
