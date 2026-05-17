'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROJECT_ROOT } = require('../shared');
const hmePaths = require('../hme_paths');
const STALENESS_PATH = hmePaths.hmeMetric('kb-staleness.json');

function reportFailure(ctx, toolResult, message) {
  const text = `[HME] post-write side effect failed: ${message}`;
  if (ctx && typeof ctx.warn === 'function') ctx.warn(text);
  if (ctx && typeof ctx.emit === 'function') ctx.emit({ event: 'post_write_side_effect_failed', message });
  if (ctx && typeof ctx.appendToResult === 'function' && toolResult) ctx.appendToResult(toolResult, `\n${text}`);
}

function bg(cmd, args, ctx, toolResult, opts = {}) {
  try {
    const child = spawn(cmd, args, { cwd: PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT }, stdio: 'ignore', detached: true, ...opts });
    child.on('error', (err) => reportFailure(ctx, toolResult, `${cmd} ${args.join(' ')}: ${err.message}`));
    child.unref();
  } catch (err) {
    reportFailure(ctx, toolResult, `${cmd} ${args.join(' ')}: ${err.message}`);
  }
}
function fp(input) { return (input && (input.file_path || input.path)) || ''; }
function isWriteTool(name) { return ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(name); }

function stalenessForFile(file) {
  const stem = path.basename(file, path.extname(file));
  try {
    const data = JSON.parse(fs.readFileSync(STALENESS_PATH, 'utf8'));
    return (data.modules || []).find((m) => m && m.module === stem) || null;
  } catch (_err) {
    return null;
  }
}

function emitWriteCoherence(ctx, file) {
  if (!ctx || typeof ctx.emit !== 'function') return;
  const stale = stalenessForFile(file);
  if (!stale || !stale.status) return;
  const moduleName = path.basename(file, path.extname(file));
  if (stale.status === 'MISSING') {
    ctx.emit({ event: 'productive_incoherence', module: moduleName, file, verdict: 'MISSING' });
  } else if (stale.status === 'STALE') {
    ctx.emit({ event: 'coherence_violation', module: moduleName, file, verdict: 'STALE' });
  }
}

module.exports = {
  name: 'post_write_side_effects',
  onToolResult({ toolUse, toolResult, ctx }) {
    const name = toolUse.name || '';
    if (!isWriteTool(name)) return;
    const input = toolUse.input || {};
    const file = fp(input);
    if (!file) return;
    emitWriteCoherence(ctx, file);
    if (/\/ISA\.md$/.test(file)) bg('python3', ['tools/HME/scripts/isa/checkpoint_hook.py', file], ctx, toolResult);
    if (/\/README\.md$/.test(file)) bg('python3', ['tools/HME/scripts/pipeline/hme/build-dir-intent-index.py'], ctx, toolResult);
    if (/\/doc\/templates\/TODO\.md$/.test(file)) bg('python3', ['tools/HME/scripts/todo_autoflip.py'], ctx, toolResult);
    const content = String(input.new_string ?? input.content ?? '');
    if (/\/Polychron\/src\/conductor\//.test(file) && /conductorIntelligence\.register(Trust|Coupling|Jurisdiction)Bias\b/.test(content)) {
      bg('node', ['src/scripts/pipeline/validators/check-hypermeta-jurisdiction.js', '--snapshot-bias-bounds'], ctx, toolResult);
      ctx.emit({ event: 'bias_bounds_snapshot_queued', file });
    }
    if (/\.(md|txt)$/.test(file) && !/\/tmp\//.test(file)) {
      try {
        const tab = path.join(PROJECT_ROOT, 'tmp/hme-note-tabs.txt');
        fs.mkdirSync(path.dirname(tab), { recursive: true });
        fs.appendFileSync(tab, `${file}\n`);
      } catch (err) { reportFailure(ctx, toolResult, `note tab tracking: ${err.message}`); }
    }
  },
};
