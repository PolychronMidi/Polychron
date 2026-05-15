#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { dispatchEvent } = require('../event_kernel/dispatcher');
const middleware = require('../proxy/middleware');

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const SESSION = process.env.HME_SESSION_ID || process.env.CODEX_SESSION_ID || 'codex-structured';

function usage() {
  console.error([
    'usage:',
    '  codex_structured_tool.js read <file>|file=<file> [offset=N] [limit=N]',
    '  codex_structured_tool.js edit file=<file> old=<text>|old_file=<path> new=<text>|new_file=<path>',
    '  codex_structured_tool.js edit --json < {"file_path":"...","old_string":"...","new_string":"..."}',
  ].join('\n'));
  process.exit(2);
}

function kvArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2).replaceAll('-', '_');
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[key] = argv[++i];
      else out[key] = 'true';
    } else if (a.includes('=')) {
      const idx = a.indexOf('=');
      out[a.slice(0, idx).replaceAll('-', '_')] = a.slice(idx + 1);
    } else out._.push(a);
  }
  return out;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (_e) { return ''; }
}

function readMaybeFile(args, key) {
  const fileKey = `${key}_file`;
  if (args[fileKey]) return fs.readFileSync(path.resolve(String(args[fileKey])), 'utf8');
  return args[key] == null ? '' : String(args[key]);
}

function absFile(filePath) {
  if (!filePath) usage();
  const p = path.resolve(String(filePath));
  const rel = path.relative(ROOT, p);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`file outside PROJECT_ROOT: ${p}`);
  }
  return p;
}

function hookJson(tool, input, extra = {}) {
  return JSON.stringify({
    cwd: ROOT,
    _hme_host: 'codex',
    _hme_synthetic_tool: true,
    session_id: SESSION,
    tool_name: tool,
    tool_input: input,
    ...extra,
  });
}

function jsonObjects(stdout) {
  return String(stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    try { return JSON.parse(line); } catch (_e) { return null; }
  }).filter(Boolean);
}

function hookDecision(result) {
  const contexts = [];
  for (const obj of jsonObjects(result.stdout)) {
    const hso = obj.hookSpecificOutput || {};
    const decision = hso.permissionDecision || (hso.decision && hso.decision.behavior) || obj.decision || '';
    const reason = hso.permissionDecisionReason || hso.additionalContext || (hso.decision && hso.decision.message) || obj.systemMessage || obj.reason || '';
    if (decision === 'deny' || decision === 'ask' || obj.decision === 'block') return { ok: false, reason: String(reason || 'blocked') };
    if (hso.additionalContext) contexts.push(String(hso.additionalContext));
  }
  if (result.exit_code && result.exit_code !== 0) return { ok: false, reason: result.stderr || `hook exit ${result.exit_code}` };
  return { ok: true, context: contexts.join('\n\n') };
}

async function pre(tool, input) {
  const result = await dispatchEvent('PreToolUse', hookJson(tool, input));
  const d = hookDecision(result);
  if (!d.ok) {
    console.error(d.reason);
    process.exit(2);
  }
  return d.context || '';
}

async function post(tool, input, response) {
  await dispatchEvent('PostToolUse', hookJson(tool, input, { tool_response: response, tool_result: response }));
}

async function enrich(tool, input, text, isError = false) {
  middleware.loadAll();
  const id = `codex-structured-${tool}-${Date.now()}`;
  const toolUse = { id, name: tool, input };
  const toolResult = { tool_use_id: id, content: text, is_error: isError };
  await middleware.runOnToolResult(toolUse, toolResult, { session: SESSION });
  return typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content);
}

function parseRead(argv) {
  const args = kvArgs(argv);
  let data = args;
  if (args.json) data = JSON.parse(readStdin() || '{}');
  const file = data.file_path || data.file || data._?.[0];
  const input = { file_path: absFile(file) };
  if (data.offset != null) input.offset = Number(data.offset);
  if (data.limit != null) input.limit = Number(data.limit);
  return input;
}

function parseEdit(argv) {
  const args = kvArgs(argv);
  let data = args;
  if (args.json) data = JSON.parse(readStdin() || '{}');
  const file = data.file_path || data.file || data._?.[0];
  return {
    file_path: absFile(file),
    old_string: data.old_string != null ? String(data.old_string) : readMaybeFile(data, 'old'),
    new_string: data.new_string != null ? String(data.new_string) : readMaybeFile(data, 'new'),
  };
}

function readSlice(text, input) {
  const lines = text.split('\n');
  const offset = Number.isFinite(input.offset) ? Math.max(0, input.offset) : 0;
  const limit = Number.isFinite(input.limit) && input.limit > 0 ? input.limit : null;
  const kept = limit == null ? lines.slice(offset) : lines.slice(offset, offset + limit);
  return kept.join('\n');
}

async function runRead(argv) {
  const input = parseRead(argv);
  await pre('Read', input);
  const text = readSlice(fs.readFileSync(input.file_path, 'utf8'), input);
  const out = await enrich('Read', input, text);
  await post('Read', input, { exit_code: 0, stdout: text });
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
}

function applyEdit(input) {
  if (!input.old_string) throw new Error('old_string/old/old_file is required');
  const text = fs.readFileSync(input.file_path, 'utf8');
  const first = text.indexOf(input.old_string);
  if (first < 0) throw new Error('old_string not found');
  if (text.indexOf(input.old_string, first + input.old_string.length) >= 0) throw new Error('old_string is not unique');
  const next = text.slice(0, first) + input.new_string + text.slice(first + input.old_string.length);
  fs.writeFileSync(input.file_path, next);
}

async function runEdit(argv) {
  const input = parseEdit(argv);
  const context = await pre('Edit', input);
  applyEdit(input);
  let out = '[SUCCESS] edit applied';
  out = await enrich('Edit', input, out);
  await post('Edit', input, { exit_code: 0, stdout: out });
  if (context) process.stdout.write(`${context}\n`);
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
}

async function main() {
  const mode = process.argv[2] || '';
  if (mode === 'read') return runRead(process.argv.slice(3));
  if (mode === 'edit') return runEdit(process.argv.slice(3));
  usage();
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
