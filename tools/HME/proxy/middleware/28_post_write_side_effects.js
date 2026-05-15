'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROJECT_ROOT } = require('../shared');

function bg(cmd, args, opts = {}) {
  try {
    const child = spawn(cmd, args, { cwd: PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT }, stdio: 'ignore', detached: true, ...opts });
    child.unref();
  } catch (_err) { /* silent-ok: best-effort side-effect. */ }
}
function fp(input) { return (input && (input.file_path || input.path)) || ''; }
function isWriteTool(name) { return ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name); }

module.exports = {
  name: 'post_write_side_effects',
  onToolResult({ toolUse, ctx }) {
    const name = toolUse.name || '';
    if (!isWriteTool(name)) return;
    const input = toolUse.input || {};
    const file = fp(input);
    if (!file) return;
    if (/\/ISA\.md$/.test(file)) bg('python3', ['tools/HME/scripts/isa/checkpoint_hook.py', file]);
    if (/\/README\.md$/.test(file)) bg('python3', ['scripts/pipeline/hme/build-dir-intent-index.py']);
    if (/\/doc\/templates\/TODO\.md$/.test(file)) bg('python3', ['tools/HME/scripts/todo_autoflip.py']);
    const content = String(input.new_string ?? input.content ?? '');
    if (/\/Polychron\/src\/conductor\//.test(file) && /conductorIntelligence\.register(Trust|Coupling|Jurisdiction)Bias\b/.test(content)) {
      bg('node', ['scripts/pipeline/validators/check-hypermeta-jurisdiction.js', '--snapshot-bias-bounds']);
      ctx.emit({ event: 'bias_bounds_snapshot_queued', file });
    }
    if (/\.(md|txt)$/.test(file) && !/\/tmp\//.test(file)) {
      try {
        const tab = path.join(PROJECT_ROOT, 'tmp/hme-note-tabs.txt');
        fs.mkdirSync(path.dirname(tab), { recursive: true });
        fs.appendFileSync(tab, `${file}\n`);
      } catch (_err) { /* silent-ok: optional note tab tracking. */ }
    }
  },
};
