'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

function permission(decision, reason = '') { return { decision, reason }; }
function relPath(file, root = PROJECT_ROOT) {
  const f = String(file || '');
  return root && f.startsWith(root + '/') ? f.slice(root.length + 1) : f.replace(/^\.\//, '');
}
function loadConfig(root = PROJECT_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'tools/HME/config/context-guards.json'), 'utf8')); }
  catch (_e) { return null; /* silent-ok: absent config means no read policy. */ }
}
function editedThisTurn(file, root = PROJECT_ROOT) {
  const base = path.basename(String(file || '')).replace(/\.[^.]*$/, '');
  if (!base) return false;
  try { return fs.readFileSync(path.join(root, 'tmp/hme-turn-edits.txt'), 'utf8').split(/\r?\n/).includes(base); }
  catch (_e) { return false; /* silent-ok: no turn edit state yet. */ }
}

function evaluateReadInput(input = {}, opts = {}) {
  const root = opts.projectRoot || PROJECT_ROOT;
  const file = input.file_path || input.path || '';
  if (!file) return permission('allow');
  const rel = relPath(file, root);
  if (opts.verifyLanded !== false && editedThisTurn(file, root)) {
    const base = path.basename(file).replace(/\.[^.]*$/, '');
    return permission('deny', `BLOCKED: verify-landed antipattern -- Read of ${base} which was Edit/Written this turn. The Edit tool already returned [SUCCESS]; re-reading is context-burn.`);
  }
  if (/\.claude\/projects\/.*\/(memory\/|MEMORY\.md)/.test(file)) {
    return permission('deny', 'BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn query="<what you need>".');
  }
  const cfg = loadConfig(root);
  if (!cfg) return permission('allow');
  for (const p of cfg.blocked_paths || []) {
    if ((p.endsWith('/') && rel.startsWith(p)) || rel === p) return permission('deny', `BLOCKED: ${rel} matches guarded path '${p}'. Use Grep with a targeted pattern, or read a smaller canonical file.`);
  }
  for (const ext of cfg.blocked_extensions || []) if (rel.endsWith(ext)) return permission('deny', `BLOCKED: ${rel} matches guarded extension '*${ext}'.`);
  for (const e of cfg.paginated_paths || []) {
    const prefix = e.prefix || '';
    if (!prefix || !rel.startsWith(prefix)) continue;
    const max = Number(e.max_lines || 200);
    const limit = Number(input.limit || 0);
    if (!limit || limit > max) return permission('deny', `BLOCKED: ${rel} is paginated-only (${e.reason || 'large file'}). Pass explicit limit<=${max} and usually offset.`);
  }
  try {
    const soft = Number(cfg.soft_size_limit_bytes || 150000);
    const st = fs.statSync(file);
    if (st.size > soft && !input.limit && !input.offset) return permission('allow', `NEXUS: ${rel} is ${Math.floor(st.size / 1024)}KB -- consider limit/offset if you only need part of it.`);
  } catch (_e) { /* silent-ok: missing/unstatable file falls through to host error. */ }
  return permission('allow');
}

function toHookResponse(result) {
  if (!result || result.decision === 'allow' && !result.reason) return '';
  if (result.decision === 'deny') return JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: result.reason }, systemMessage: result.reason });
  return JSON.stringify({ hookSpecificOutput: { permissionDecision: 'allow', additionalContext: result.reason }, systemMessage: result.reason });
}

module.exports = { evaluateReadInput, toHookResponse };
