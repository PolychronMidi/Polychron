'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { PROJECT_ROOT } = require('../shared');

const OUT_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-subagent-audits');
const FILE_RE = /(?:^|\s)(\/?[\w.-][\w./-]*\.(?:js|mjs|cjs|py|sh|json))(?:\b|$)/g;

function _textOf(toolResult) {
  const c = toolResult && toolResult.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((x) => x && x.type === 'text').map((x) => x.text || '').join('\n');
  return '';
}

function _files(text) {
  const out = new Set();
  let m;
  while ((m = FILE_RE.exec(text || '')) !== null) {
    const raw = m[1].startsWith('/') ? m[1] : path.join(PROJECT_ROOT, m[1]);
    if (raw.startsWith(PROJECT_ROOT) && fs.existsSync(raw)) out.add(raw);
  }
  return [...out].slice(0, 20);
}

function _run(cmd) {
  return cp.spawnSync(cmd[0], cmd.slice(1), { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 30_000 });
}

module.exports = {
  name: 'subagent_clean_gate',
  onToolResult({ toolUse, toolResult, ctx }) {
    if (!toolUse || toolUse.name !== 'Agent') return;
    const files = _files(_textOf(toolResult));
    if (files.length === 0) return;
    const results = [];
    for (const file of files) {
      if (/\.py$/.test(file)) results.push({ file, check: 'py_compile', status: _run(['python3', '-m', 'py_compile', file]).status || 0 });
      results.push({ file, check: 'comment_bloat', status: _run(['python3', path.join(PROJECT_ROOT, 'scripts', 'audit-comment-bloat.py'), '--files', file]).status || 0 });
    }
    const bad = results.filter((r) => r.status !== 0);
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${toolUse.id || Date.now()}.json`), JSON.stringify({ files, results, bad }, null, 2));
    } catch (_e) { /* silent-ok: audit file is advisory; ctx.emit still records status */ }
    ctx.emit({ event: bad.length ? 'subagent_clean_gate_failed' : 'subagent_clean_gate_ok', files: files.length, failures: bad.length });
    if (bad.length) ctx.appendToResult(toolResult, `\n\n[HME subagent clean-gate: ${bad.length} audit failure(s); inspect tmp/hme-subagent-audits]`);
  },
};
