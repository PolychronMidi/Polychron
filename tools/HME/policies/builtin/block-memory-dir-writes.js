'use strict';
/**
 * Block writes to .claude/projects/.../memory/ — that directory is
 * deprecated. Cross-session knowledge belongs in HME KB (`i/learn`);
 * behavioral rules belong in CLAUDE.md.
 */

module.exports = {
  name: 'block-memory-dir-writes',
  description: 'Block writes to .claude/projects/*/memory/* (deprecated; use HME KB or CLAUDE.md).',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (/\.claude\/projects\/.*\/(memory\/|MEMORY\.md)/.test(fp)) {
      return ctx.deny(
        'BLOCKED: The .claude/projects memory directory is deprecated. Use HME KB instead: i/learn title="..." content="..." category="feedback". Memories that point at behavioral rules belong in CLAUDE.md, not memory/.'
      );
    }
    return ctx.allow();
  },
};
