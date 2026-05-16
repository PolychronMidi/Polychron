'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

const CONTROL_RE = /[|;&<>`]/;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__']);

function shellWords(text) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'\\])/g, '$1'));
  return out;
}

function normalizeRel(file, root = PROJECT_ROOT) {
  const f = String(file || '');
  if (root && f.startsWith(root + '/')) return f.slice(root.length + 1);
  return f.replace(/^\.\//, '');
}

function safePath(target, root = PROJECT_ROOT, kind = 'any') {
  const rel = normalizeRel(target, root);
  if (!rel || rel.startsWith('-') || /[$`{};|&<>]/.test(rel)) return '';
  const abs = path.resolve(root, rel);
  const back = path.relative(root, abs);
  if (back.startsWith('..') || path.isAbsolute(back)) return '';
  try {
    const st = fs.statSync(abs);
    if (kind === 'file' && !st.isFile()) return '';
    if (kind === 'dir' && !st.isDirectory()) return '';
  } catch (_e) { return ''; }
  return back || '.';
}

function guards(root = PROJECT_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'tools/HME/config/context-guards.json'), 'utf8')); }
  catch (_e) { return null; }
}

function guarded(rel, cfg, usedPagination = false) {
  if (!rel || !cfg) return false;
  for (const p of cfg.blocked_paths || []) if ((p.endsWith('/') && rel.startsWith(p)) || rel === p) return true;
  for (const ext of cfg.blocked_extensions || []) if (rel.endsWith(ext)) return true;
  if (!usedPagination) for (const e of cfg.paginated_paths || []) if (e.prefix && rel.startsWith(e.prefix)) return true;
  return false;
}

function structured(action, input) {
  const tool = 'codex_' + 'structured_tool.js';
  return `node tools/HME/scripts/${tool} ${action} --json <<'HME_CODEX_JSON'\n${JSON.stringify(input)}\nHME_CODEX_JSON`;
}

function readRewrite(tokens, root, cfg) {
  const name = path.basename(tokens[0] || '');
  const mk = (file, paginated, extra = {}) => {
    const rel = safePath(file, root, 'file');
    if (!rel || guarded(rel, cfg, paginated)) return '';
    return structured('read', { file_path: rel, ...extra });
  };
  if (name === 'cat' && tokens.length === 2) return mk(tokens[1], false);
  if (name === 'head' || name === 'tail') {
    let limit = 10; let file = '';
    if (tokens.length === 2) file = tokens[1];
    else if (tokens.length === 3 && /^-\d+$/.test(tokens[1])) { limit = Math.abs(Number(tokens[1])); file = tokens[2]; }
    else if (tokens.length === 4 && tokens[1] === '-n') { limit = Math.abs(Number(tokens[2])); file = tokens[3]; }
    if (!file || limit <= 0) return '';
    return name === 'tail' ? mk(file, true, { tail: limit }) : mk(file, true, { limit });
  }
  if (name === 'sed' && tokens.length === 4 && tokens[1] === '-n') {
    const m = /^(\d+),(\d+)p$/.exec(tokens[2]) || /^(\d+)p$/.exec(tokens[2]);
    if (!m) return '';
    const start = Number(m[1]);
    const end = Number(m[2] || m[1]);
    if (start > 0 && end >= start) return mk(tokens[3], true, { offset: start - 1, limit: end - start + 1 });
  }
  return '';
}

function grepRewrite(tokens, root) {
  const name = path.basename(tokens[0] || '');
  if (!['rg', 'grep', 'egrep', 'fgrep'].includes(name)) return '';
  let ignoreCase = false; let fixed = name === 'fgrep'; let pattern = ''; const paths = [];
  for (let i = 1; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (['-i', '--ignore-case'].includes(t)) { ignoreCase = true; continue; }
    if (['-F', '--fixed-strings'].includes(t)) { fixed = true; continue; }
    if (['-n', '--line-number', '-S', '--smart-case', '--hidden'].includes(t)) continue;
    if (['-e', '--regexp'].includes(t)) { pattern = tokens[++i] || ''; continue; }
    if (t.startsWith('-')) return '';
    if (!pattern) pattern = t;
    else paths.push(t);
  }
  if (!pattern) return '';
  const rels = (paths.length ? paths : ['.']).map((p) => safePath(p, root)).filter(Boolean);
  if (!rels.length) return '';
  return structured('grep', { pattern, path: rels[0], paths: rels, ignore_case: ignoreCase, fixed, limit: 200 });
}

function globRewrite(tokens, root) {
  const name = path.basename(tokens[0] || '');
  if (name === 'ls') {
    const args = tokens.slice(1).filter((t) => !t.startsWith('-'));
    const rel = safePath(args[0] || '.', root);
    return rel ? structured('glob', { path: rel, pattern: '*', max_depth: 1, limit: 300 }) : '';
  }
  if (name === 'find') {
    let base = tokens[1] && !tokens[1].startsWith('-') ? tokens[1] : '.';
    let maxDepth = 4; let pattern = '*'; let type = '';
    for (let i = 2; i < tokens.length; i += 1) {
      if (tokens[i] === '-maxdepth') maxDepth = Number(tokens[++i] || 4);
      else if (tokens[i] === '-name') pattern = tokens[++i] || '*';
      else if (tokens[i] === '-type') type = tokens[++i] || '';
      else if (tokens[i].startsWith('-')) return '';
    }
    const rel = safePath(base, root);
    return rel && maxDepth >= 0 ? structured('glob', { path: rel, pattern, max_depth: maxDepth, type, limit: 500 }) : '';
  }
  if (name === 'wc' && tokens.length === 3 && tokens[1] === '-l') {
    const rel = safePath(tokens[2], root, 'file');
    return rel ? structured('count', { file_path: rel, mode: 'lines' }) : '';
  }
  return '';
}

function gitRewrite(tokens) {
  if (path.basename(tokens[0] || '') !== 'git') return '';
  const sub = tokens[1] || '';
  if (!['status', 'diff', 'show', 'log'].includes(sub)) return '';
  if (tokens.some((t) => /[;&|<>`$]/.test(t))) return '';
  if (tokens.length > 24) return '';
  return structured('git', { args: tokens.slice(1), limit: 500 });
}

function statusRewrite(tokens, cmd, root) {
  const name = path.basename(tokens[0] || '');
  if (name === 'pgrep' || name === 'ps') return `${root}/i/hme admin action=health`;
  if (name === 'curl' && /127\.0\.0\.1|localhost/.test(cmd) && /\/health\b|\/v1\/models\b/.test(cmd)) return `${root}/i/hme admin action=health`;
  if (['tail', 'cat', 'head', 'grep'].includes(name) && /\blog\//.test(cmd)) return `${root}/i/status mode=activity`;
  return '';
}


function controlStatusRewrite(cmd, root) {
  if (/\bps\s+-[A-Za-z]*[ef][A-Za-z]*\b.*\|\s*grep\b/.test(cmd)) return `${root}/i/hme admin action=health`;
  if (/\b(tail|cat|head|grep)\b.*\blog\//.test(cmd)) return `${root}/i/status mode=activity`;
  return '';
}

function rawCommandRewrite(cmd, root = PROJECT_ROOT) {
  if (!cmd) return '';
  const control = controlStatusRewrite(cmd, root);
  if (control) return control;
  if (CONTROL_RE.test(cmd)) return '';
  const tokens = shellWords(cmd);
  if (!tokens.length) return '';
  const cfg = guards(root);
  return readRewrite(tokens, root, cfg)
    || grepRewrite(tokens, root)
    || globRewrite(tokens, root)
    || gitRewrite(tokens)
    || statusRewrite(tokens, cmd, root)
    || '';
}

module.exports = { rawCommandRewrite, shellWords, structured };
