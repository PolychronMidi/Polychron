'use strict';
const path = require('path');
const { PROJECT_ROOT, hasMisplacedRootOnlyDir } = require('../../proxy/shared');
/**
 * Block `mkdir <path-with-/log-or-/tmp-/>` outside the project root.
 * Bash analog of the file-write block-misplaced-log-tmp policy, but for
 * Bash mkdir commands instead of Write/Edit. JS port of the gate in
 * blackbox_guards.sh.
 */

const HAS_MKDIR = /\bmkdir\b/;
const STOP_TOKENS = new Set(['&&', '||', ';', '|']);

function _tokens(cmd) {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(cmd))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function _mkdirTargets(cmd) {
  const targets = [];
  let capture = false;
  for (const token of _tokens(cmd)) {
    if (token === 'mkdir' || token.endsWith('/mkdir')) {
      capture = true;
      continue;
    }
    if (!capture) continue;
    if (STOP_TOKENS.has(token)) {
      capture = false;
      continue;
    }
    if (token.startsWith('-')) continue;
    targets.push(token);
  }
  return targets;
}

module.exports = {
  name: 'block-mkdir-misplaced-log-tmp',
  description: 'Block `mkdir` of log/ or tmp/ subdirectories outside the project root.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!HAS_MKDIR.test(cmd)) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || PROJECT_ROOT;
    const bad = _mkdirTargets(cmd).some((target) => {
      const expanded = target
        .replace(/\$\{PROJECT_ROOT\}/g, projectRoot)
        .replace(/\$PROJECT_ROOT/g, projectRoot);
      const full = path.isAbsolute(expanded) ? expanded : path.join(projectRoot, expanded);
      return hasMisplacedRootOnlyDir(full, ['log', 'tmp'], projectRoot);
    });
    if (!bad) return ctx.allow();
    return ctx.deny(
      'BLOCKED: log/ and tmp/ only exist at project root. Do not mkdir subdirectory variants. Route output through $PROJECT_ROOT/{log,tmp}/.'
    );
  },
};
