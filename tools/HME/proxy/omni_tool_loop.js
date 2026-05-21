'use strict';

const path = require('path');
const { spawnSync } = require('child_process');
const { evaluateBashInput, blockedCommand } = require('./bash_command_policy');
const { PROJECT_ROOT } = require('./shared');

const TOOL_NAMES = new Set(['Read', 'Bash', 'Edit', 'Write', 'WebFetch', 'Agent']);
const BRIDGE_ACTIONS = { Read: 'read', Edit: 'edit', Write: 'write', WebFetch: 'web_fetch', Agent: 'agent' };
const BRIDGE_SCRIPT = path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'codex_structured_tool.js');
const MAX_OUTPUT = 200000;
const EMPTY_BASH_TOOL_RESULT = [
  'HME adapter notice: ignored an empty Bash tool call because no command was provided.',
  'This notice is not task context and should not be treated as the user request.',
  'Continue from the latest user request/session objective; do not ask the user to resend context solely because of this adapter notice.',
].join('\n');
const MAX_TOOL_LOOP_DEPTH = 8;

function parseSseEvents(text) {
  const events = [];
  for (const raw of String(text || '').split(/\r?\n\r?\n/)) {
    const lines = raw.split(/\r?\n/);
    let eventName = '';
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith('event: ')) eventName = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
    }
    const dataStr = dataLines.join('\n');
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      events.push({ event: eventName, data: JSON.parse(dataStr) });
    } catch (_e) { /* skip non-JSON */ }
  }
  return events;
}

function extractToolUses(parsed) {
  if (!parsed || !Array.isArray(parsed.content)) return [];
  const uses = [];
  for (const block of parsed.content) {
    if (block && block.type === 'tool_use' && block.id && TOOL_NAMES.has(block.name)) {
      uses.push({ id: block.id, name: block.name, input: block.input || {} });
    }
  }
  return uses;
}

function extractSseToolUses(text) {
  const events = parseSseEvents(text);
  const uses = [];
  let current = null;
  let inputJson = '';
  const seen = new Set();
  for (const ev of events) {
    if (!ev || !ev.data) continue;
    if (ev.event === 'content_block_start' && ev.data.content_block && ev.data.content_block.type === 'tool_use') {
      const cb = ev.data.content_block;
      current = { id: cb.id, name: cb.name, input: {} };
      inputJson = '';
    } else if (ev.event === 'content_block_delta' && ev.data.delta && ev.data.delta.type === 'input_json_delta' && current) {
      inputJson += ev.data.delta.partial_json || '';
    } else if (ev.event === 'content_block_stop' && current) {
      try {
        if (inputJson) current.input = JSON.parse(inputJson);
      } catch (_e) { /* keep empty input */ }
      if (TOOL_NAMES.has(current.name) && !seen.has(current.id)) {
        seen.add(current.id);
        uses.push(current);
      }
      current = null;
      inputJson = '';
    }
  }
  return uses;
}

function toolInput(name, args) {
  const file = args.file_path || args.file || '';
  if (name === 'Read') {
    const out = { file_path: file };
    if (args.offset != null) out.offset = Number(args.offset);
    if (args.limit != null) out.limit = Number(args.limit);
    return out;
  }
  if (name === 'Write') return { file_path: file, content: String(args.content || '') };
  if (name === 'Edit') return {
    file_path: file,
    old_string: String(args.old_string || ''),
    new_string: String(args.new_string || ''),
    ...(args.replace_all ? { replace_all: true } : {}),
  };
  if (name === 'WebFetch') return { url: String(args.url || ''), prompt: String(args.prompt || '') };
  if (name === 'Agent') {
    const prompt = String(args.prompt || '');
    return { prompt, description: String(args.description || args.justification || prompt.split(/\r?\n/)[0].slice(0, 60) || 'Subagent task'), ...(args.level != null ? { level: Number(args.level) } : {}) };
  }
  return args;
}

function runBridgedTool(name, input) {
  const json = JSON.stringify(input);
  return spawnSync(process.execPath, [BRIDGE_SCRIPT, BRIDGE_ACTIONS[name], '--json'], {
    cwd: PROJECT_ROOT, input: json, encoding: 'utf8',
    timeout: 120000, env: { ...process.env, PROJECT_ROOT },
  });
}

function runBashTool(args) {
  const command = String(args.command || args.cmd || '');
  if (!command.trim()) return { status: 2, stdout: EMPTY_BASH_TOOL_RESULT, stderr: '', hmeAdapterNotice: 'empty_bash_command' };
  const verdict = evaluateBashInput({ command }, { projectRoot: PROJECT_ROOT, supportsRunInBackground: false });
  let cmd = command;
  if (verdict && verdict.decision === 'deny') return { status: 1, stdout: '', stderr: blockedCommand(verdict.reason || 'blocked') };
  if (verdict && verdict.input) cmd = String(verdict.input.command || verdict.input.cmd || command);
  const timeout = Math.min(Math.max(Number(args.timeout || args.timeout_ms || 120000), 1), 600000);
  return spawnSync('bash', ['-lc', cmd], {
    cwd: PROJECT_ROOT, encoding: 'utf8', timeout,
    env: { ...process.env, PROJECT_ROOT },
  });
}

function toolOutput(result) {
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const text = result.status === 0 ? stdout : `${stdout}${stderr ? (stdout ? '\n' : '') + stderr : ''}`;
  return (text || (result.error ? String(result.error.message || result.error) : '')).slice(0, MAX_OUTPUT);
}

function _validateToolInput(name, input) {
  if (name === 'Read' || name === 'Write' || name === 'Edit') {
    const fp = input.file_path || input.file || '';
    if (!fp.trim()) return `Error: file_path is required for ${name}. The path must be an absolute file path.`;
  }
  return null;
}

function executeToolUse(use, opts) {
  const root = (opts && opts.projectRoot) || PROJECT_ROOT;
  if (use.name === 'Bash') {
    const result = runBashTool(use.input);
    return { type: 'tool_result', tool_use_id: use.id, content: toolOutput(result) };
  }
  const input = toolInput(use.name, use.input);
  const validationError = _validateToolInput(use.name, input);
  if (validationError) return { type: 'tool_result', tool_use_id: use.id, content: validationError };
  const result = runBridgedTool(use.name, input);
  return { type: 'tool_result', tool_use_id: use.id, content: toolOutput(result) };
}

function executeAll(uses, opts) {
  return uses.map((u) => executeToolUse(u, opts));
}

function buildFollowupPayload(originalPayload, assistantMsg, toolResults) {
  const payload = JSON.parse(JSON.stringify(originalPayload));
  payload.messages.push(assistantMsg);
  payload.messages.push({ role: 'user', content: toolResults });
  payload.stream = false;
  return payload;
}

async function runToolLoop({
  fullBody, headers, payload, transport, upstreamOpts, upstreamHeaders,
  projectRoot, depth = 0,
}) {
  if (depth >= MAX_TOOL_LOOP_DEPTH) {
    console.error(`[omni-tool-loop] depth limit (${MAX_TOOL_LOOP_DEPTH}) reached`);
    return null;
  }

  const ctype = (headers['content-type'] || '').toLowerCase();
  const isSse = ctype.includes('text/event-stream');
  const bodyStr = fullBody.toString('utf8');

  const toolUses = isSse ? extractSseToolUses(bodyStr) : extractToolUses(_tryParseJson(bodyStr));
  if (!toolUses.length) {
    if (depth > 0) console.error(`[omni-tool-loop] final response at depth ${depth}`);
    return null;
  }

  console.error(`[omni-tool-loop] ${toolUses.length} tool calls at depth ${depth}: ${toolUses.map((u) => u.name).join(', ')}`);

  const toolResults = executeAll(toolUses, { projectRoot });

  let assistantMsg;
  if (isSse) {
    const text = _sseText(bodyStr);
    assistantMsg = { role: 'assistant', content: [{ type: 'text', text: text || '(tool calls executed by proxy)' }] };
  } else {
    const parsed = _tryParseJson(bodyStr);
    const rawContent = (parsed && parsed.content) || [];
    const content = _filterAssistantContent(rawContent);
    assistantMsg = { role: 'assistant', content };
  }

  const followupPayload = buildFollowupPayload(payload, assistantMsg, toolResults);
  const followupBody = Buffer.from(JSON.stringify(followupPayload), 'utf8');
  const followupOpts = { ...upstreamOpts, headers: { ...upstreamHeaders, 'content-length': String(followupBody.length) } };

  const resp = await new Promise((res, rej) => {
    const req = transport.request(followupOpts, (r) => {
      const cs = [];
      r.on('data', (c) => cs.push(c));
      r.on('end', () => res({ status: r.statusCode || 502, headers: { ...r.headers }, body: Buffer.concat(cs) }));
      r.on('error', rej);
    });
    req.setTimeout(300_000, () => req.destroy(new Error('omni-tool-loop followup timeout')));
    req.on('error', rej);
    req.write(followupBody);
    req.end();
  });

  console.error(`[omni-tool-loop] depth=${depth} followup status=${resp.status} bodyLen=${resp.body.length} ctype=${resp.headers['content-type'] || '?'}`);

  if (resp.status < 200 || resp.status >= 300) {
    console.error(`[omni-tool-loop] upstream error at depth ${depth}: ${resp.status} body=${resp.body.toString('utf8').slice(0, 300)}`);
    return null;
  }

  if (resp.body.length === 0) {
    console.error(`[omni-tool-loop] empty response body at depth ${depth} -- aborting tool loop (upstream may have failed silently)`);
    return null;
  }

  const nested = await runToolLoop({
    fullBody: resp.body,
    headers: resp.headers,
    payload: followupPayload,
    transport,
    upstreamOpts,
    upstreamHeaders,
    projectRoot,
    depth: depth + 1,
  });

  return nested || { status: resp.status, headers: resp.headers, fullBody: resp.body };
}

function _tryParseJson(buf) {
  try { return JSON.parse(buf.toString('utf8')); } catch (_e) { return {}; }
}

function _filterAssistantContent(content) {
  if (!Array.isArray(content)) return content;
  return content.filter((block) => {
    if (!block || typeof block !== 'object') return false;
    const t = block.type;
    if (t === 'thinking' || t === 'redacted_thinking') return false;
    return true;
  });
}

function _sseText(bodyStr) {
  const text = [];
  for (const ev of String(bodyStr || '').split('\n\n')) {
    for (const line of ev.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          if (d && d.delta && d.delta.text) text.push(d.delta.text);
        } catch (_) {}
      }
    }
  }
  return text.join('');
}

module.exports = { runToolLoop, extractToolUses, extractSseToolUses, parseSseEvents, MAX_TOOL_LOOP_DEPTH, EMPTY_BASH_TOOL_RESULT };
