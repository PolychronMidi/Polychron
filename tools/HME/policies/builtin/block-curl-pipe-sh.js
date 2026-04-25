'use strict';
/**
 * Block `curl ... | sh` and `wget ... | bash` and variants — primary
 * supply-chain attack pattern. JS port of the bash gate in
 * tools/HME/hooks/pretooluse/bash/blackbox_guards.sh; the bash gate
 * remains primary while bash dispatch flows through pretooluse_bash.sh,
 * but this policy is loaded into the unified registry so it can be
 * listed, configured, and (eventually) executed by future JS hook
 * dispatch paths without duplicating the regex.
 */

// Detection: pipe operator anywhere in command, RHS starts with sh/bash/
// zsh/ksh/dash optionally prefixed with `.`, `sudo`, or `exec`. LHS verb
// is curl/wget/fetch (the typical download-then-pipe pattern).
const PIPE_TO_SHELL = /\b(?:curl|wget|fetch)\b[^|]*\|[\s]*(?:\.[\s]+|sudo[\s]+|exec[\s]+)?(?:sh|bash|zsh|ksh|dash)\b/;

const REASON =
  'BLOCKED: piping a remote download into a shell interpreter (curl|sh, wget|bash, etc.) is a primary supply-chain attack pattern. Download to a file, inspect it, then execute deliberately if needed.';

module.exports = {
  name: 'block-curl-pipe-sh',
  description: 'Block curl|sh and wget|sh patterns (supply-chain attack vector).',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (PIPE_TO_SHELL.test(cmd)) return ctx.deny(REASON);
    return ctx.allow();
  },
};
