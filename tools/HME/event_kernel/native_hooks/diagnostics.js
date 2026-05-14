'use strict';

const {
  PROJECT_ROOT,
  allow,
  fs,
  path,
  runNodeTool,
  runPython,
  toolInput,
} = require('./common');

async function posttoolDiagnostics(stdinJson) {
  const file = toolInput(stdinJson).file_path || '';
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return allow();
  const ext = path.extname(file);
  let stderr = '';
  if (['.js', '.mjs', '.cjs'].includes(ext) && fs.existsSync(path.join(PROJECT_ROOT, 'package.json'))) {
    const r = runNodeTool('npx', ['eslint', '--quiet', file], 20_000);
    stderr += r.stderr || r.stdout || '';
  } else if (ext === '.py') {
    const r = runPython(['-m', 'py_compile', file], '', 20_000, 'py-compile');
    stderr += r.stderr || r.stdout || '';
  }
  const audit = path.join(PROJECT_ROOT, 'scripts', 'audit-comment-bloat.py');
  if (fs.existsSync(audit)) {
    const r = runPython([audit, '--files', file], '', 20_000, 'comment-bloat-audit');
    stderr += r.stderr || r.stdout || '';
  }
  return allow('', stderr || ' ');
}

module.exports = { posttoolDiagnostics };
