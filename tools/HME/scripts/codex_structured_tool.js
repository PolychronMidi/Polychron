#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { dispatchEvent } = require('../event_kernel/dispatcher');
const middleware = require('../proxy/middleware');
const { recordFailure, clearFailure } = require('../proxy/turn_failure_state');

const ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const SESSION = process.env.HME_SESSION_ID || process.env.CODEX_SESSION_ID || 'codex-structured';
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', 'tmp', 'runtime', 'log', 'KB']);
const GREP_MAX_BYTES = 1024 * 1024;
const DISPLAY_REDACTED_RE = /<display-redacted:|<omitted by proxy>/i;

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
function malformedPath(raw) {
  const s = String(raw ?? '');
  return !s.trim() || /[\r\n]/.test(s) || s.trim().startsWith('<<') || /HME_CODEX_JSON|[{}]/.test(s);
}
function pathCandidates(p) {
  const raw = String(p ?? '').trim();
  const cleaned = raw.replace(/^['"`]+|['"`.,;:]+$/g, '');
  return cleaned && cleaned !== raw ? [raw, cleaned] : [raw];
}
function absPath(p, mustExist = true) {
  if (malformedPath(p)) throw new Error(`invalid file_path: ${String(p ?? '').slice(0, 80) || '(empty)'}`);
  let lastErr = null;
  for (const candidate of pathCandidates(p)) {
    const abs = path.resolve(ROOT, candidate);
    const rel = path.relative(ROOT, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`path outside PROJECT_ROOT: ${abs}`);
    try {
      if (mustExist) fs.statSync(abs);
      return abs;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error(`path not found: ${String(p ?? '')}`);
}
function absFilePath(p) {
  const abs = absPath(p);
  if (!fs.statSync(abs).isFile()) throw new Error(`file_path is not a file: ${relPath(abs)}`);
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
async function finishStructured(tool, input, text, opts = {}) {
  const isError = opts.isError === true;
  const out = await enrich(opts.enrichTool || tool, opts.enrichInput || input, text, isError);
  await post(opts.postTool || tool, opts.postInput || input, { exit_code: isError ? 1 : 0, stdout: isError ? out : (opts.rawStdout ?? text), stderr: isError ? (opts.rawStderr ?? text) : '', is_error: isError });
  if (!isError) clearFailure(ROOT);
  process.stdout.write(out.endsWith('\n') ? out : `${out}\n`);
  if (isError) process.exit(1);
  return out;
}
function jsonData(argv) { const args = kvArgs(argv); return args.json ? JSON.parse(readStdin() || '{}') : args; }

function parseRead(argv) { const data = jsonData(argv); const input = { file_path: absFilePath(data.file_path || data.file || data._?.[0]) }; if (data.offset != null) input.offset = Number(data.offset); if (data.limit != null) input.limit = Number(data.limit); if (data.tail != null) input.tail = Number(data.tail); return input; }
function parseEdit(argv) { const data = jsonData(argv); return { file_path: absFilePath(data.file_path || data.file || data._?.[0]), old_string: data.old_string != null ? String(data.old_string) : readMaybeFile(data, 'old'), new_string: data.new_string != null ? String(data.new_string) : readMaybeFile(data, 'new') }; }
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
function splitPathList(raw) {
  if (Array.isArray(raw)) return raw;
  const s = String(raw || '.');
  if (!/\s/.test(s)) return [s];
  return s.split(/\s+/).filter(Boolean);
}
function parseGrep(argv) {
  const d = jsonData(argv);
  const rawPath = d.path || d._?.[1] || '.';
  return {
    pattern: String(d.pattern || d._?.[0] || ''),
    path: rawPath,
    paths: d.paths || splitPathList(rawPath),
    ignore_case: Boolean(d.ignore_case),
    fixed: Boolean(d.fixed),
    limit: Number(d.limit || 200),
  };
}
function parseGlob(argv) { const d = jsonData(argv); return { pattern: String(d.pattern || d._?.[0] || '*'), path: d.path || d._?.[1] || '.', max_depth: Number(d.max_depth ?? 8), type: d.type || '', limit: Number(d.limit || 500) }; }

async function runRead(argv) { const input = parseRead(argv); await pre('Read', input); const text = readSlice(fs.readFileSync(input.file_path, 'utf8'), input); await finishStructured('Read', input, text); }

function countOccurrences(text, needle) { if (!needle) return 0; let n = 0; let i = 0; while ((i = text.indexOf(needle, i)) >= 0) { n++; i += Math.max(1, needle.length); } return n; }
function editVariants(input, text) {
  const variants = [{ ...input, _why: 'exact' }];
  const old = input.old_string || '';
  const neu = input.new_string || '';
  if (old.includes('\\n') && !old.includes('\n')) variants.push({ ...input, old_string: old.replace(/\\n/g, '\n'), new_string: neu.replace(/\\n/g, '\n'), _why: 'decoded literal \\n' });
  if (old.includes('\\t') && !old.includes('\t')) variants.push({ ...input, old_string: old.replace(/\\t/g, '\t'), new_string: neu.replace(/\\t/g, '\t'), _why: 'decoded literal \\t' });
  if (text.includes('\r\n') && old.includes('\n') && !old.includes('\r\n')) variants.push({ ...input, old_string: old.replace(/\n/g, '\r\n'), new_string: neu.replace(/\n/g, '\r\n'), _why: 'crlf-normalized' });
  if (!text.includes('\r\n') && old.includes('\r\n')) variants.push({ ...input, old_string: old.replace(/\r\n/g, '\n'), new_string: neu.replace(/\r\n/g, '\n'), _why: 'lf-normalized' });
  return variants;
}
function contextWindow(file, oldString, newString, reason) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const anchors = [...String(oldString || '').split(/\r?\n/), ...String(newString || '').split(/\r?\n/)]
    .map((s) => s.trim()).filter((s) => s.length >= 6);
  let hit = 0;
  for (const a of anchors) { const idx = lines.findIndex((line) => line.includes(a)); if (idx >= 0) { hit = idx; break; } }
  const start = Math.max(0, hit - 20);
  const end = Math.min(lines.length, hit + 21);
  const body = lines.slice(start, end).map((line, i) => `${String(start + i + 1).padStart(5, ' ')} ${line}`).join('\n');
  return `Error: ${reason}\n[READ current context ${relPath(file)}:${start + 1}-${end}]\n${body}`;
}
function editFailure(input, reason) { const err = new Error(reason); err.userMessage = contextWindow(input.file_path, input.old_string, input.new_string, reason); return err; }
function escapeRe(text) { return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function trailingWhitespaceMatch(text, oldString) {
  const pattern = String(oldString).split('\n').map(escapeRe).join('[ \t]*\n') + (String(oldString).endsWith('\n') ? '' : '[ \t]*');
  const re = new RegExp(pattern, 'g');
  const hits = [];
  let match;
  while ((match = re.exec(text)) !== null) {
    hits.push({ first: match.index, old_string: match[0] });
    if (match[0].length === 0) re.lastIndex += 1;
    if (hits.length > 1) break;
  }
  return hits;
}
function applyEdit(input) {
  if (!input.old_string) throw editFailure(input, 'old_string/old/old_file is required');
  if (DISPLAY_REDACTED_RE.test(input.old_string)) throw editFailure(input, 'old_string is display-redacted; pass actual file text');
  const text = fs.readFileSync(input.file_path, 'utf8');
  if (text.indexOf(input.old_string) < 0 && input.new_string && countOccurrences(text, input.new_string) === 1) return { status: 'already_applied' };
  for (const candidate of editVariants(input, text)) {
    const first = text.indexOf(candidate.old_string);
    if (first < 0) continue;
    if (text.indexOf(candidate.old_string, first + candidate.old_string.length) >= 0) throw editFailure(input, `old_string is not unique (${candidate._why})`);
    fs.writeFileSync(input.file_path, text.slice(0, first) + candidate.new_string + text.slice(first + candidate.old_string.length));
    return { status: candidate._why === 'exact' ? 'applied' : `applied via ${candidate._why}` };
  }
  const wsHits = trailingWhitespaceMatch(text, input.old_string);
  if (wsHits.length > 1) throw editFailure(input, 'old_string is not unique (trailing-whitespace-normalized)');
  if (wsHits.length === 1) {
    const hit = wsHits[0];
    fs.writeFileSync(input.file_path, text.slice(0, hit.first) + input.new_string + text.slice(hit.first + hit.old_string.length));
    return { status: 'applied via trailing-whitespace-normalized' };
  }
  throw editFailure(input, 'old_string not found');
}
async function runEdit(argv) {
  let input;
  try { input = parseEdit(argv); }
  catch (err) {
    const message = `Error: ${err.message}`;
    recordFailure(ROOT, { tool: 'Edit', reason: err.message, file: '', session_id: SESSION });
    await finishStructured('Edit', { file_path: '' }, message, { isError: true, rawStderr: message });
    return;
  }
  if (DISPLAY_REDACTED_RE.test(input.old_string)) {
    const err = editFailure(input, 'old_string is display-redacted; pass actual file text');
    const message = err.userMessage || `Error: ${err.message}`;
    recordFailure(ROOT, { tool: 'Edit', reason: err.message, file: input.file_path, session_id: SESSION });
    await finishStructured('Edit', input, message, { isError: true, rawStderr: message });
    return;
  }
  const context = await pre('Edit', input);
  try {
    const result = applyEdit(input);
    const label = result.status === 'already_applied' ? '[SUCCESS] edit already applied' : `[SUCCESS] edit ${result.status}`;
    if (context) process.stdout.write(`${context}\n`);
    await finishStructured('Edit', input, label);
  } catch (err) {
    const message = err.userMessage || `Error: ${err.message}`;
    recordFailure(ROOT, { tool: 'Edit', reason: err.message, file: input.file_path, session_id: SESSION });
    await finishStructured('Edit', input, message, { isError: true, rawStderr: message });
  }
}
async function runGrep(argv) {
  const input = parseGrep(argv);
  if (!input.pattern) usage();
  await pre('Grep', input);
  const flags = input.ignore_case ? 'i' : '';
  const re = input.fixed ? null : new RegExp(input.pattern, flags);
  const bases = [];
  const skipped = [];
  for (const p of (input.paths || [input.path])) {
    try { bases.push(absPath(p)); }
    catch (err) {
      if (err && err.code === 'ENOENT') skipped.push(String(p));
      else {
        const msg = `Error: invalid grep path '${String(p).slice(0, 120)}': ${err.message}`;
        await finishStructured('Grep', input, msg, { isError: true, rawStderr: msg });
        return;
      }
    }
  }
  if (!bases.length) {
    const msg = `Error: no valid grep path(s); skipped ${skipped.length}: ${skipped.slice(0, 8).join(', ')}`;
    await finishStructured('Grep', input, msg, { isError: true, rawStderr: msg });
    return;
  }
  const lines = [];
  for (const b of bases) {
    for (const fp of walk(b, 10)) {
      let text;
      try {
        if (fs.statSync(fp).size > GREP_MAX_BYTES) continue;
        text = fs.readFileSync(fp, 'utf8');
      } catch (_e) { continue; }
      const rel = relPath(fp);
      text.split(/\r?\n/).some((line, idx) => {
        const hit = input.fixed
          ? (input.ignore_case ? line.toLowerCase().includes(input.pattern.toLowerCase()) : line.includes(input.pattern))
          : re.test(line);
        if (hit) lines.push(`${rel}:${idx + 1}:${line}`);
        return lines.length >= input.limit;
      });
      if (lines.length >= input.limit) break;
    }
    if (lines.length >= input.limit) break;
  }
  await finishStructured('Grep', input, lines.join('\n'));
}
async function runGlob(argv) { const input = parseGlob(argv); await pre('Glob', input); const base = absPath(input.path); const re = globToRe(input.pattern); const rows = walk(base, input.max_depth).map(relPath).filter((r) => re.test(path.basename(r)) || re.test(r)).slice(0, input.limit); await finishStructured('Glob', input, rows.join('\n')); }
async function runCount(argv) { const d = jsonData(argv); const fp = absPath(d.file_path || d.file || d._?.[0]); const text = fs.readFileSync(fp, 'utf8'); await finishStructured('Bash', { command: `wc -l ${relPath(fp)}` }, `${relPath(fp)}:${text.split(/\r?\n/).length - 1}`); }
async function runGit(argv) {
  const d = jsonData(argv);
  const args = Array.isArray(d.args) ? d.args.map(String) : (d._ || []).map(String);
  if (!['status', 'diff', 'show', 'log'].includes(args[0]) || args.length > 24) usage();
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', timeout: 10000 });
  const code = Number.isInteger(r.status) ? r.status : (r.error ? 1 : 0);
  const raw = ((r.stdout || '') + (r.stderr || '')).slice(0, Number(d.limit || 500) * 200);
  await finishStructured('Bash', { command: `git ${args.join(' ')}` }, raw, { isError: code !== 0, rawStdout: raw, rawStderr: raw });
}

async function main() { const mode = process.argv[2] || ''; if (mode === 'read') return runRead(process.argv.slice(3)); if (mode === 'edit') return runEdit(process.argv.slice(3)); if (mode === 'grep') return runGrep(process.argv.slice(3)); if (mode === 'glob') return runGlob(process.argv.slice(3)); if (mode === 'count') return runCount(process.argv.slice(3)); if (mode === 'git') return runGit(process.argv.slice(3)); usage(); }
main().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
