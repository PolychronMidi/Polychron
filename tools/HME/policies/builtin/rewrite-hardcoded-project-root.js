'use strict';
const { requireEnv: _hmeRequireEnv } = require('../../proxy/shared/load_env.js');
// Rewrite Write/Edit content that hardcodes the literal PROJECT_ROOT path.

const path = require('path');
const PROJECT_ROOT = _hmeRequireEnv('PROJECT_ROOT');

const _ROOT_EXEMPT_FILE = /(\/\.env(\.[a-z]+)?$|\/README(\.[a-z]+)?$|\/CLAUDE\.md$|\/tools\/HME\/KB\/devlog\/|\/doc\/[^/]+\.md$|\/doc\/archive\/)/;

function _findHits(content, root) {
  const lines = content.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(root)) hits.push(i + 1);
  }
  return hits;
}

function _hasJsonRootField(content, root) {
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('"PROJECT_ROOT":[^,}]*"' + escaped + '"').test(content);
}

function _rewriteContent(content, root) {
  return content.split(root).join('$PROJECT_ROOT');
}

function _rewriteToolInput(ti, newContent) {
  const out = { ...ti };
  if ('content' in ti && typeof ti.content === 'string') out.content = newContent;
  if ('new_string' in ti && typeof ti.new_string === 'string') out.new_string = newContent;
  if (Array.isArray(ti.edits)) {
    out.edits = ti.edits.map((e) => (e && typeof e.new_string === 'string')
      ? { ...e, new_string: e.new_string.split(root).join('$PROJECT_ROOT') }
      : e);
  }
  return out;
}

module.exports = {
  name: 'rewrite-hardcoded-project-root',
  description: 'Rewrite Write/Edit content that embeds the literal PROJECT_ROOT path; substitute $PROJECT_ROOT.',
  category: 'style',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const ti = ctx.toolInput || {};
    const fp = ti.file_path || '';
    if (_ROOT_EXEMPT_FILE.test(fp)) return ctx.allow();
    let content = ti.content || ti.new_string || '';
    if (!content && Array.isArray(ti.edits)) {
      content = ti.edits.map((e) => (e && e.new_string) || '').join('\n');
    }
    if (!content || !content.includes(PROJECT_ROOT)) return ctx.allow();
    if (_hasJsonRootField(content, PROJECT_ROOT)) return ctx.allow();
    const hits = _findHits(content, PROJECT_ROOT);
    if (!hits.length) return ctx.allow();
    const newContent = _rewriteContent(content, PROJECT_ROOT);
    const updated = _rewriteToolInput(ti, newContent);
    return ctx.rewrite(updated, `DDoC stripped: hardcoded project root → $PROJECT_ROOT (lines [${hits.join(',')}])`);
  },
};
