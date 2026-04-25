'use strict';
/**
 * Block deletion / mv-aside / redirect-truncate of tmp/run.lock. JS port of
 * the shlex-tokenized guard in pretooluse/bash/blackbox_guards.sh. Both
 * gates remain active (defense-in-depth for proxy-down direct-mode); JS
 * runs first via the unified registry and short-circuits the bash chain
 * when matched.
 *
 * Coverage: rm/unlink/shred/truncate verbs, find -delete, mv away,
 * redirect truncate (>tmp/run.lock), python/node scripted unlink.
 * Same matrix as the bash version — verified by integration test in
 * the previous PR (8/9 bypass attempts blocked; the only escape is
 * runtime variable substitution which would need an actual shell to
 * resolve).
 */

const LOCK_TOKEN = 'run.lock';
const DELETION_VERBS = new Set(['rm', 'unlink', 'shred', 'truncate']);

// Lightweight POSIX-shell argv tokenizer. Handles single quotes, double
// quotes, and basic escaping. Falls back to whitespace split on parse
// error. Comments not stripped (the bash version doesn't either).
function _tokenize(cmd) {
  const out = [];
  let buf = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < cmd.length) {
    const c = cmd[i];
    if (inSingle) {
      if (c === "'") inSingle = false;
      else buf += c;
      i++; continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === '\\' && i + 1 < cmd.length) { buf += cmd[i + 1]; i += 2; continue; }
      else buf += c;
      i++; continue;
    }
    if (c === "'") { inSingle = true; i++; continue; }
    if (c === '"') { inDouble = true; i++; continue; }
    if (c === '\\' && i + 1 < cmd.length) { buf += cmd[i + 1]; i += 2; continue; }
    if (/\s/.test(c)) {
      if (buf) { out.push(buf); buf = ''; }
      i++; continue;
    }
    buf += c;
    i++;
  }
  if (buf) out.push(buf);
  if (inSingle || inDouble) {
    // Mismatched quotes: fall back to whitespace split.
    return cmd.split(/\s+/).filter(Boolean);
  }
  return out;
}

function _verdict(cmd) {
  const tokens = _tokenize(cmd);
  const lockTokens = tokens.filter((t) => t.includes(LOCK_TOKEN));
  const verbs = new Set(tokens.filter((t) => DELETION_VERBS.has(t)));

  if (verbs.size > 0 && lockTokens.length > 0) return 'BLOCK:deletion_verb';
  if (tokens.includes('find') && lockTokens.length > 0 && tokens.includes('-delete')) {
    return 'BLOCK:find_delete';
  }
  if (tokens.includes('mv')) {
    const mvIdx = tokens.indexOf('mv');
    const args = tokens.slice(mvIdx + 1).filter((t) => !t.startsWith('-'));
    if (args.length > 0 && args[0].includes(LOCK_TOKEN)) return 'BLOCK:mv_lock';
  }
  if (/>\s*[^|&;\s]*run\.lock\b/.test(cmd)) return 'BLOCK:redirect_truncate';
  if (['python3', 'python', 'node', 'perl', 'ruby'].some((v) => tokens.includes(v))) {
    if (/(os\.remove|os\.unlink|unlink(Sync)?|shutil\.move|Path[^)]*\.unlink)/.test(cmd)
        && lockTokens.length > 0) {
      return 'BLOCK:scripted_unlink';
    }
  }
  return null;
}

module.exports = {
  name: 'block-runlock-deletion',
  description: 'Block any deletion / move / truncate of tmp/run.lock (argv-tokenized).',
  category: 'security',
  defaultEnabled: true,
  match: { events: ['PreToolUse'], tools: ['Bash'] },
  params: {},
  async fn(ctx) {
    const cmd = (ctx.toolInput && ctx.toolInput.command) || '';
    if (!cmd.includes(LOCK_TOKEN)) return ctx.allow();
    const v = _verdict(cmd);
    if (v) return ctx.deny(`BLOCKED: Never delete run.lock (matched: ${v})`);
    return ctx.allow();
  },
};
