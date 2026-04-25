'use strict';
/**
 * Block writes to tools/HME/chat/out — out/ is compiled output from
 * tools/HME/chat/src/*.ts. Direct edits get clobbered on next tsc. JS
 * port of the bash gate in pretooluse_write.sh. The bash gate also runs
 * `tsc` to compile pending src/ changes; we keep the bash gate active
 * for that side effect and let the JS policy short-circuit to a clearer
 * deny reason when only the JS path runs.
 */

module.exports = {
  name: 'block-out-dir-writes',
  description: 'Block direct writes to tools/HME/chat/out/ (compiled artifact, edit src/*.ts instead).',
  category: 'consistency',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Write', 'Edit', 'MultiEdit'] },
  params: {},
  async fn(ctx) {
    const fp = (ctx.toolInput && ctx.toolInput.file_path) || '';
    if (fp.includes('tools/HME/chat/out/')) {
      return ctx.deny(
        'BLOCKED: tools/HME/chat/out/ is compiled output. Edit the .ts source in tools/HME/chat/src/ instead. Run npx tsc --noEmit -p tools/HME/chat to verify after edits.'
      );
    }
    return ctx.allow();
  },
};
