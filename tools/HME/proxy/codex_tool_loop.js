'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { PROJECT_ROOT } = require('./shared');
const { canonicalToolNames, missingRequiredFields } = require('./hme_tool_registry');

const TOOL_NAMES = canonicalToolNames();
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

function sseKeyCandidates(value) {
  if (!value || typeof value !== 'object') return [];
  return [value.call_id, value.id, value.item_id, value.output_index != null ? `output:${value.output_index}` : '']
    .filter((x) => x != null && String(x) !== '')
    .map(String);
}

function collectSseToolCalls(text) {
  const calls = [];
  const seenObjects = new Set();
  const byKey = new Map();
  let lastCall = null;

  function remember(seed = {}) {
    const keys = sseKeyCandidates(seed);
    let call = keys.map((key) => byKey.get(key)).find(Boolean) || null;
    if (!call) {
      call = { type: 'function_call', id: seed.call_id || seed.id || seed.item_id || '', call_id: seed.call_id || seed.id || seed.item_id || '', name: seed.name || '', arguments: seed.arguments != null ? seed.arguments : '' };
      seenObjects.add(call);
    }
    if (seed.name) call.name = seed.name;
    if (seed.call_id) call.call_id = seed.call_id;
    if (seed.id) call.id = seed.id;
    if (seed.item_id && !call.id) call.id = seed.item_id;
    if (seed.arguments != null && seed.arguments !== '') call.arguments = seed.arguments;
    for (const key of sseKeyCandidates({ ...seed, call_id: call.call_id, id: call.id })) byKey.set(key, call);
    lastCall = call;
    return call;
  }

  for (const event of parseSseEvents(text)) {
    if (!event || typeof event !== 'object') continue;
    if (event.item && event.item.type === 'function_call') remember(event.item);
    else if (event.type === 'response.output_item.done' && event.item) collectFromValue(event.item, calls, new Set());

    if (/function_call_arguments\.delta$/.test(String(event.type || ''))) {
      const call = remember(event);
      call.arguments = `${call.arguments || ''}${event.delta || ''}`;
    } else if (/function_call_arguments\.done$/.test(String(event.type || ''))) {
      remember({ ...event, arguments: event.arguments != null ? event.arguments : event.delta });
    }
  }

  const seenIds = new Set(calls.map((call) => call.id));
  for (const call of seenObjects) {
    const id = callId(call);
    if (!TOOL_NAMES.has(call.name) || !id || seenIds.has(id)) continue;
    seenIds.add(id);
    calls.push({ id, name: call.name, args: callArgs(call) });
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
  if (name === 'Bash') return { command: String(args.command || args.cmd || ''), ...(args.timeout != null ? { timeout: Number(args.timeout) } : {}), ...(args.description != null ? { description: String(args.description) } : {}), ...(args.run_in_background != null ? { run_in_background: Boolean(args.run_in_background) } : {}) };
  return args;
}

function runSmolTool(name, args, root) {
  const script = path.join(__dirname, '..', 'hme_tools', 'run_tool.py');
  const input = JSON.stringify(inputFor(name, args));
  return spawnSync('python3', [script, name, '--json'], { cwd: root, input, encoding: 'utf8', timeout: 120000, env: { ...process.env, PROJECT_ROOT: root, HME_SOURCE_ROOT: path.resolve(__dirname, '..', '..', '..') } });
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

function hasOwn(value, key) {
  return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

function missingRequiredToolFields(call) {
  if (!call || typeof call !== 'object') return [];
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  if (call.name === 'Bash') return String(args.command || args.cmd || '').trim() ? [] : ['command'];
  if (call.name === 'Agent') return String(args.prompt || '').trim() ? [] : ['prompt'];
  if (call.name === 'Read') return String(args.file_path || args.file || '').trim() ? [] : ['file_path'];
  if (call.name === 'WebFetch') {
    return [String(args.url || '').trim() ? '' : 'url', String(args.prompt || '').trim() ? '' : 'prompt'].filter(Boolean);
  }
  if (call.name === 'Write') {
    return [String(args.file_path || args.file || '').trim() ? '' : 'file_path', hasOwn(args, 'content') ? '' : 'content'].filter(Boolean);
  }
  if (call.name === 'Edit') {
    return [
      String(args.file_path || args.file || '').trim() ? '' : 'file_path',
      String(args.old_string || '').length ? '' : 'old_string',
      hasOwn(args, 'new_string') ? '' : 'new_string',
    ].filter(Boolean);
  }
  return [];
}

function isIncompleteToolCall(call) {
  return missingRequiredToolFields(call).length > 0;
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

module.exports = { collectToolCalls, collectSseToolCalls, parseSseEvents, executeToolCall, toolResultInput, followupBody, isIncompleteToolCall, missingRequiredToolFields, EMPTY_BASH_TOOL_RESULT };
