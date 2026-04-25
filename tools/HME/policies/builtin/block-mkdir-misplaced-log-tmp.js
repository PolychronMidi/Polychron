'use strict';
/**
 * Block `mkdir <path-with-/log-or-/tmp-/>` outside the project root.
 * Bash analog of the file-write block-misplaced-log-tmp policy, but for
 * Bash mkdir commands instead of Write/Edit. JS port of the gate in
 * blackbox_guards.sh.
 */

const HAS_MKDIR = /\bmkdir\b/;
const HAS_NESTED_LOG_TMP = /\/(log|tmp)($|\/)/;

module.exports = {
  name: 'block-mkdir-misplaced-log-tmp',
  description: 'Block `mkdir` of log/ or tmp/ subdirectories outside the project root.',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!HAS_MKDIR.test(cmd) || !HAS_NESTED_LOG_TMP.test(cmd)) return ctx.allow();
    const projectRoot = process.env.PROJECT_ROOT || '/home/jah/Polychron';
    const escaped = projectRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const allowed = new RegExp('"?' + escaped + '/(log|tmp)');
    if (allowed.test(cmd)) return ctx.allow();
    return ctx.deny(
      'BLOCKED: log/ and tmp/ only exist at project root. Do not mkdir subdirectory variants. Route output through $PROJECT_ROOT/{log,tmp}/.'
    );
  },
};
