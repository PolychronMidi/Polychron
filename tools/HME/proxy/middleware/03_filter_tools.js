'use strict';
const { parseEnvFile: _parseEnvFile } = require('../shared/load_env.js');
// Drops configured tool definitions before Anthropic to make tools unavailable.
// Env: HME_FILTER_TOOLS_DROP=tool1,tool2,...; unset is a no-op.

const fs = require('fs');
const path = require('path');

function _stripInlineComment(value) {
  return String(value || '').replace(/\s+#.*$/, '').trim();
}

function _projectDropList(projectRoot) {
  const root = typeof projectRoot === 'string' ? projectRoot.trim() : '';
  if (!root) return '';
  try {
    const values = _parseEnvFile(path.join(root, '.env'));
    return values.get('HME_FILTER_TOOLS_DROP') || '';
  } catch (_err) { return ''; /* optional config */ }
}

function _optionalProcessDropList() {
  if (!Object.prototype.hasOwnProperty.call(process.env, 'HME_FILTER_TOOLS_DROP')) return '';
  return process.env.HME_FILTER_TOOLS_DROP;
}

function _dropSet(projectRoot) {
  const raw = [_optionalProcessDropList(), _projectDropList(projectRoot)];
  return new Set(raw.flatMap((s) => _stripInlineComment(s).split(',')).map((s) => s.trim()).filter(Boolean));
}

module.exports = {
  name: 'filter_tools',
  onRequest({ payload, ctx }) {
    if (!payload || !Array.isArray(payload.tools)) return;
    const DROP_SET = _dropSet(ctx.PROJECT_ROOT);
    if (DROP_SET.size === 0) return;
    const before = payload.tools.length;
    // Rescue cache_control from any dropped tool: Claude Code attaches the
    let rescuedCC = null;
    const kept = payload.tools.filter((t) => {
      const name = t && typeof t.name === 'string' ? t.name : '';
      const drop = DROP_SET.has(name);
      if (drop && t && t.cache_control) rescuedCC = t.cache_control;
      return !drop;
    });
    if (kept.length === before) return;
    if (rescuedCC && kept.length > 0) {
      const last = kept[kept.length - 1];
      if (last && !last.cache_control) last.cache_control = rescuedCC;
    }
    payload.tools = kept;
    ctx.markDirty();
  },
};
