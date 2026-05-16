#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { dispatchEvent } = require('../event_kernel/dispatcher');
const middleware = require('../proxy/middleware');

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const SESSION = process.env.HME_SESSION_ID || process.env.CODEX_SESSION_ID || 'codex-structured';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__']);

function usage() {
  console.error([
    'usage:',
    '  codex_structured_tool.js read <file>|file=<file> [offset=N] [limit=N] [tail=N]',
    '  codex_structured_tool.js edit file=<file> old=<text>|old_file=<path> new=<text>|new_file=<path>',
    '  codex_structured_tool.js grep pattern=<pat> [path=<file-or-dir>] [limit=N]',
    '  codex_structured_tool.js glob pattern=<glob> [path=<dir>] [max_depth=N]',
    '  codex_structured_tool.js git --json < {"args":["status","--short"]}',
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

function readStdin() { try { return fs.readFileSync(0, 'utf8'); } catch (_e) { return ''; } }
function readMaybeFile(args, key) { return args[`${key}_file`] ? fs.readFileSync(path.resolve(String(args[`${key}_file`])), 'utf8') : (args[key] == null ? '' : String(args[key])); }
function relPath(abs) { const rel = path.relative(ROOT, abs); return rel || '.'; }
function absPath(p, mustExist = true) {
  const abs = path.resolve(ROOT, String(p || '.'));
  const rel = path.relative(ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path outside PROJECT_ROOT: ${abs}`);
  if (mustExist) fs.statSync(abs);
  return abs;
}
function hookJson(tool, input, extra = {}) { return JSON.stringify({ cwd: ROOT, _hme_host: 'codex', _hme_synthetic_tool: true, session_id: SESSION, tool_name: tool, tool_input: input, ...extra }); }
function jsonObjects(stdout) { return String(stdout || '').split(/\r?\n/).map((line) => { try { return JSON.parse(line.trim()); } catch (_e) { return null; } }).filter(Boolean); }
function hookDecision(result) {
  const contexts = [];
  for (const obj of jsonObjects(result.stdout)) {
    const hso = obj.hookSpecificOutput || {};
    const decision = hso.permissionDecision || obj.decision || '';
    const reason = hso.permissionDecisionReason || hso.additionalContext || obj.systemMessage || obj.reason || '';
    if (decision === 'deny' || decision === 'ask' || obj.decision === 'block') return { ok: false, reason: String(reason || 'blocked') };
    if (hso.additionalContext) contexts.push(String(hso.additionalContext));
  }
  if (result.exit_code && result.exit_code !== 0) return { ok: false, reason: result.stderr || `hook exit ${result.exit_code}` };
  return { ok: true, context: contexts.join('\n\n') };
}
async function pre(tool, input) { const d = hookDecision(await dispatchEvent('PreToolUse', hookJson(tool, input))); if (!d.ok) { console.error(d.reason); process.exit(2); } return d.context || ''; }
async function post(tool, input, response) { await dispatchEvent('PostToolUse', hookJson(tool, input, { tool_response: response, tool_result: response })); }
async function enrich(tool, input, text, isError = false) { middleware.loadAll(); const id = `codex-structured-${tool}-${Date.now()}`; const toolUse = { id, name: tool, input }; const toolResult = { tool_use_id: id, content: text, is_error: isError }; await middleware.runOnToolResult(toolUse, toolResult, { session: SESSION }); return typeof toolResult.content === 'string' ? toolResult.content : JSON.stringify(toolResult.content); }
function jsonData(argv) { const args = kvArgs(argv); return args.json ? JSON.parse(readStdin() || '{}') : args; }

function parseRead(argv) { const data = jsonData(argv); const input = { file_path: absPath(data.file_path || data.file || data._?.[0]) }; if (data.offset != null) input.offset = Number(data.offset); if (data.limit != null) input.limit = Number(data.limit); if (data.tail != null) input.tail = Number(data.tail); return input; }
function parseEdit(argv) { const data = jsonData(argv); return { file_path: absPath(data.file_path || data.file || data._?.[0]), old_string: data.old_string != null ? String(data.old_string) : readMaybeFile(data, 'old'), new_string: data.new_string != null ? String(data.new_string) : readMaybeFile(data, 'new') }; }
function readSlice(text, input) { const lines = text.split('\n'); if (Number.isFinite(input.tail) && input.tail > 0) return lines.slice(-input.tail).join('\n'); const offset = Number.isFinite(input.offset) ? Math.max(0, input.offset) : 0; const limit = Number.isFinite(input.limit) && input.limit > 0 ? input.limit : null; return (limit == null ? lines.slice(offset) : lines.slice(offset, offset + limit)).join('\n'); }

function walk(base, maxDepth, out = [], depth = 0) {
  const st = fs.statSync(base);
  if (st.isFile()) { out.push(base); return out; }
  if (!st.isDirectory() || depth > maxDepth) return out;
  for (const ent of fs.readdirSync(base, { withFileTypes: true })) {
    if (SKIP_DIRS.has(ent.name)) continue;
    const fp = path.join(base, ent.name);
    if (ent.isDirectory()) walk(fp, maxDepth, out, depth + 1);
    else if (ent.isFile()) out.push(fp);
    if (out.length > 10000) break;
  }
  return out;
}
function globToRe(pattern) { return new RegExp(`^${String(pattern || '*').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*')}$`); }
function parseGrep(argv) { const d = jsonData(argv); return { pattern: String(d.pattern || d._?.[0] || ''), path: d.path || d._?.[1] || '.', paths: d.paths || null, ignore_case: Boolean(d.ignore_case), fixed: Boolean(d.fixed), limit: Number(d.limit || 200) }; }
function parseGlob(argv) { const d = jsonData(argv); return { pattern: String(d.pattern || d._?.[0] || '*'), path: d.path || d._?.[1] || '.', max_depth: Number(d.max_depth ?? 8), type: d.type || '', limit: Number(d.limit || 500) }; }

async function runRead(argv) { const input = parseRead(argv); await pre('Read', input); const text = readSlice(fs.readFileSync(input.file_path, 'utf8'), input); const out = await enrich('Read', input, text); await post('Read', input, { exit_code: 0, stdout: text }); process.stdout.write(out.endsWith('\n') ? out : `${out}\n`); }
function applyEdit(input) { if (!input.old_string) throw new Error('old_string/old/old_file is required'); const text = fs.readFileSync(input.file_path, 'utf8'); const first = text.indexOf(input.old_string); if (first < 0) throw new Error('old_string not found'); if (text.indexOf(input.old_string, first + input.old_string.length) >= 0) throw new Error('old_string is not unique'); fs.writeFileSync(input.file_path, text.slice(0, first) + input.new_string + text.slice(first + input.old_string.length)); }
async function runEdit(argv) { const input = parseEdit(argv); const context = await pre('Edit', input); applyEdit(input); let out = await enrich('Edit', input, '[SUCCESS] edit applied'); await post('Edit', input, { exit_code: 0, stdout: out }); if (context) process.stdout.write(`${context}\n`); process.stdout.write(out.endsWith('\n') ? out : `${out}\n`); }
async function runGrep(argv) { const input = parseGrep(argv); if (!input.pattern) usage(); await pre('Grep', input); const flags = input.ignore_case ? 'i' : ''; const re = input.fixed ? null : new RegExp(input.pattern, flags); const bases = (input.paths || [input.path]).map((p) => absPath(p)); const lines = []; for (const b of bases) for (const fp of walk(b, 10)) { const rel = relPath(fp); const text = fs.readFileSync(fp, 'utf8'); text.split(/\r?\n/).some((line, idx) => { const hit = input.fixed ? (input.ignore_case ? line.toLowerCase().includes(input.pattern.toLowerCase()) : line.includes(input.pattern)) : re.test(line); if (hit) lines.push(`${rel}:${idx + 1}:${line}`); return lines.length >= input.limit; }); if (lines.length >= input.limit) break; } const outText = lines.join('\n'); const out = await enrich('Grep', input, outText); await post('Grep', input, { exit_code: 0, stdout: outText }); process.stdout.write(out.endsWith('\n') ? out : `${out}\n`); }
async function runGlob(argv) { const input = parseGlob(argv); await pre('Glob', input); const base = absPath(input.path); const re = globToRe(input.pattern); const rows = walk(base, input.max_depth).map(relPath).filter((r) => re.test(path.basename(r)) || re.test(r)).slice(0, input.limit); const text = rows.join('\n'); const out = await enrich('Glob', input, text); await post('Glob', input, { exit_code: 0, stdout: text }); process.stdout.write(out.endsWith('\n') ? out : `${out}\n`); }
async function runCount(argv) { const d = jsonData(argv); const fp = absPath(d.file_path || d.file || d._?.[0]); const text = fs.readFileSync(fp, 'utf8'); process.stdout.write(`${relPath(fp)}:${text.split(/\r?\n/).length - 1}\n`); }
async function runGit(argv) { const d = jsonData(argv); const args = Array.isArray(d.args) ? d.args.map(String) : (d._ || []).map(String); if (!['status', 'diff', 'show', 'log'].includes(args[0]) || args.length > 24) usage(); const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10000 }); const text = (r.stdout || '') + (r.stderr || ''); process.stdout.write(text.slice(0, Number(d.limit || 500) * 200)); }

async function main() { const mode = process.argv[2] || ''; if (mode === 'read') return runRead(process.argv.slice(3)); if (mode === 'edit') return runEdit(process.argv.slice(3)); if (mode === 'grep') return runGrep(process.argv.slice(3)); if (mode === 'glob') return runGlob(process.argv.slice(3)); if (mode === 'count') return runCount(process.argv.slice(3)); if (mode === 'git') return runGit(process.argv.slice(3)); usage(); }
main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
