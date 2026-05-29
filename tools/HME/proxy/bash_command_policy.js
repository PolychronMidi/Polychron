'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const { mkdirHasMisplacedRootOnlyDir, mkdirHasMisplacedMetrics, rootOnlyDirMessage, metricsMessage } = require('./path_policy');
const { rawCommandRewrite } = require('./raw_command_rewrites');
const { noopAfterFailureDecision, isNoopCommand, clearFailure } = require('./turn_failure_state');

const LOCK_NAME = 'run.lock';
const I_TOOLS = '(review|learn|trace|evolve|status|hme|audit|why|policies)';
const READERS = new Set(['cat', 'less', 'more', 'bat', 'batcat', 'head', 'tail', 'xxd', 'od']);
const SPECIAL_READERS = new Set(['sed', 'awk', 'diff']);
const GIT_CONTENT = new Set(['diff', 'show', 'log', 'blame', 'cat-file']);
const REDIRECTS = new Set(['<', '<<', '<<<', '>', '>>', '|', '||', '&&', ';', '&']);

function shellWords(text) {
  const out = [];
  const re = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/\\(["'\\])/g, '$1'));
  return out;
}

function shellQuote(s) { return `'${String(s).replace(/'/g, `'\\''`)}'`; }
function deny(reason, code = 'blocked') { return { decision: 'deny', reason, code }; }
function allow(input, note = '', changed = false) { return { decision: 'allow', input, reason: note, changed }; }
// SSE-stream fallback only. The PRIMARY enforcement is the PreToolUse hook
// (pretooluse_bash.sh -> toHookResponse), which returns a real
// permissionDecision:"deny" with the reason -- the command never runs. This
function blockedCommand(reason) { return `printf %s\\n ${shellQuote(reason)} >&2; exit 2`; }

function normalizeRel(file, root = PROJECT_ROOT) {
  const f = String(file || '');
  if (root && f.startsWith(root + '/')) return f.slice(root.length + 1);
  return f.replace(/^\.\//, '');
}

function setCommandInput(input, command) {
  if (Object.prototype.hasOwnProperty.call(input, 'cmd') && !Object.prototype.hasOwnProperty.call(input, 'command')) input.cmd = command;
  else input.command = command;
  return input;
}

function readGuardsConfig(root = PROJECT_ROOT) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'tools/HME/config/context-guards.json'), 'utf8')); }
  catch (_e) { return null; }
}

function contextHit(file, cfg, usedPagination = false, root = PROJECT_ROOT) {
  if (!file || !cfg) return '';
  const rel = normalizeRel(file, root);
  for (const p of cfg.blocked_paths || []) if ((p.endsWith('/') && rel.startsWith(p)) || rel === p) return p;
  for (const ext of cfg.blocked_extensions || []) if (rel.endsWith(ext)) return `*${ext}`;
  if (!usedPagination) for (const e of cfg.paginated_paths || []) {
    const prefix = e.prefix || '';
    if (prefix && rel.startsWith(prefix)) return `${prefix} (paginated-only; pass -n N or use Read with limit)`;
  }
  return '';
}

function takesValue(cmd, flag) {
  const val = { head: new Set(['-n', '-c']), tail: new Set(['-n', '-c']), sed: new Set(['-e', '-f']), awk: new Set(['-f', '-F', '-v']), od: new Set(['-A', '-j', '-N', '-w', '-S', '-t']), xxd: new Set(['-s', '-l', '-c', '-g']) };
  return Boolean(val[cmd] && val[cmd].has(flag));
}

function readerGuard(cmd, root = PROJECT_ROOT) {
  if (!/\b(cat|head|tail|less|more|batcat|bat|diff|sed|awk|xxd|od|git)\b/.test(cmd)) return null;
  const cfg = readGuardsConfig(root);
  if (!cfg) return null;
  const tokens = shellWords(cmd);
  for (let i = 0; i < tokens.length; i += 1) {
    const name = path.basename(tokens[i]);
    if (['sudo', 'env', 'time', 'nice'].includes(name)) continue;
    if (name === 'git') {
      const sub = tokens.slice(i + 1).find((t) => !t.startsWith('-'));
      if (!GIT_CONTENT.has(sub)) continue;
      for (const t of tokens.slice(i + 2)) {
        if (REDIRECTS.has(t)) break;
        if (t === '--' || t.startsWith('-')) continue;
        const candidate = t.includes(':') && !t.startsWith('/') ? t.split(':').pop() : t;
        const hit = contextHit(candidate, cfg, false, root);
        if (hit) return deny(`BLOCKED: Bash reader targets context-guarded path '${hit}' (via git ${sub}). Use Grep with a targeted pattern, or Read with limit/offset.`);
      }
    }
    if (READERS.has(name)) {
      let usedPagination = false;
      for (let j = i + 1; j < tokens.length; j += 1) {
        const t = tokens[j];
        if (REDIRECTS.has(t)) break;
        if (t.startsWith('-')) {
          if (takesValue(name, t)) { usedPagination = true; j += 1; continue; }
          if (t.slice(1).match(/^\d+$/) && (name === 'head' || name === 'tail')) usedPagination = true;
          continue;
        }
        const hit = contextHit(t, cfg, usedPagination, root);
        if (hit) return deny(`BLOCKED: Bash reader targets context-guarded path '${hit}'. Use Grep with a targeted pattern, or Read with limit/offset.`);
        break;
      }
    }
    if (SPECIAL_READERS.has(name)) {
      let positional = 0; let programFlag = false;
      for (let j = i + 1; j < tokens.length; j += 1) {
        const t = tokens[j];
        if (REDIRECTS.has(t)) break;
        if (t.startsWith('-')) { if (takesValue(name, t)) { if ((name === 'sed' && ['-e', '-f'].includes(t)) || (name === 'awk' && t === '-f')) programFlag = true; j += 1; } continue; }
        positional += 1;
        if ((name === 'sed' || name === 'awk') && positional === 1 && !programFlag) continue;
        const hit = contextHit(t, cfg, false, root);
        if (hit) return deny(`BLOCKED: Bash reader targets context-guarded path '${hit}' (via ${name}). Use Grep with a targeted pattern, or Read with limit/offset.`);
      }
    }
  }
  return null;
}

function lockDeletion(cmd) {
  if (!cmd.includes(LOCK_NAME)) return null;
  const tokens = shellWords(cmd);
  const joined = tokens.join(' ');
  if (tokens.some((t) => ['rm', 'unlink', 'shred', 'truncate'].includes(t)) && tokens.some((t) => t.includes(LOCK_NAME))) return 'deletion_verb';
  if (tokens.includes('find') && tokens.includes('-delete') && tokens.some((t) => t.includes(LOCK_NAME))) return 'find_delete';
  if (tokens.includes('mv') && tokens.slice(tokens.indexOf('mv') + 1).find((t) => !t.startsWith('-'))?.includes(LOCK_NAME)) return 'mv_lock';
  if (new RegExp(`>\\s*[^|&;\\s]*${LOCK_NAME.replace('.', '\\.')}\\b`).test(cmd)) return 'redirect_truncate';
  if (/(python3?|node|perl|ruby)/.test(joined) && /(os\.remove|os\.unlink|unlink(Sync)?|shutil\.move|Path[^)]*\.unlink)/.test(cmd)) return 'scripted_unlink';
  return null;
}

function codeChangedAfter(root, mtime) {
  for (const dir of ['src', 'tools/HME']) {
    const base = path.join(root, dir);
    if (!fs.existsSync(base)) continue;
    const stack = [base];
    while (stack.length) {
      const cur = stack.pop();
      for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
        const fp = path.join(cur, ent.name);
        if (ent.isDirectory()) stack.push(fp);
        else if (/\.(js|ts|py|sh|json|md)$/.test(ent.name) && fs.statSync(fp).mtimeMs > mtime) return true;
      }
    }
  }
  return false;
}

function evaluateLogFirst(cmd, root) {
  const trimmed = cmd.trim();
  const target = (trimmed === 'npm run lint' || trimmed === 'npm run lint:raw') ? 'lint.log' : (trimmed === 'npm run tc' ? 'tc.log' : '');
  if (!target) return null;
  const log = path.join(root, 'log', target);
  if (!fs.existsSync(log)) return null;
  if (codeChangedAfter(root, fs.statSync(log).mtimeMs)) return null;
  return deny(`BLOCKED: log/${target} is current and no code changed since. Read the existing log instead of re-running. Override with ': force-rerun;' if truly needed.`);
}

function verifyLanded(cmd, root) {
  if (process.env.HME_VERIFY_LANDED_OK === '1' || /^\s*HME_VERIFY_LANDED_OK=1\b/.test(cmd)) return null;
  const file = path.join(root, 'tmp/hme-turn-edits.txt');
  let edited = [];
  try { edited = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean); }
  catch (_e) { return null; /* silent-ok: no turn edit state yet. */ }
  if (!edited.length) return null;
  const tokens = shellWords(cmd);
  if (tokens.some((t) => ['python', 'python3', 'node', 'bash', 'sh', 'pytest', 'ruby', 'perl', 'go', 'deno'].includes(path.basename(t)))) return null;
  if (tokens.some((t) => path.basename(t) === 'git' || path.isAbsolute(t) && normalizeRel(t, root).startsWith(['t', 'mp'].join('') + '/'))) return null;
  const verbs = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'cat', 'head', 'tail', 'less', 'more', 'bat', 'batcat', 'wc', 'awk', 'sed']);
  if (!tokens.some((t) => verbs.has(path.basename(t)))) return null;
  const hit = tokens.map((t) => path.basename(t).replace(/\.[^.]*$/, '')).find((b) => edited.includes(b));
  return hit ? { hit } : null;
}

function pollingDecision(cmd, root) {
  if (!/(tail|cat|head|grep|wc|ls).*\/tmp\/(claude.*\.log|.*\.output)|\bnvidia-smi\b.*query|ps\s+-[aef]+.*\|\s*grep/.test(cmd)) return null;
  const file = path.join(root, 'tmp/hme-task-poll-count');
  let n = 0;
  try { n = Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch (_e) { /* silent-ok: absent counter starts at zero. */ }
  n += 1;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(n)); } catch (_e) { /* silent-ok: counter is advisory. */ }
  return n > 2 ? deny(`BLOCKED: repeated background-status polling #${n}. Wait for completion notification or do independent work.`) : null;
}

function feedbackKbSpam(cmd) {
  return /i\/learn\b/.test(cmd) && /title=(['"])?Feedback:/i.test(cmd)
    ? deny('BLOCKED: KB titles starting with Feedback: are agent self-notes and spam the KB. Put durable behavioral rules in doc/templates/AGENTS.md or rephrase as project knowledge.')
    : null;
}

const LIFESAVER_ESCALATION_STATE = 'tools/HME/runtime/lifesaver-escalation-since.ts';
const LIFESAVER_ESCALATION_THRESHOLD_S = 300;

function lifesaverEscalation(root) {
  const file = path.join(root, LIFESAVER_ESCALATION_STATE);
  let firstSeen;
  try { firstSeen = parseInt(String(fs.readFileSync(file, 'utf8')).trim(), 10); }
  catch (_e) { return null; /* silent-ok: no state = no escalation */ }
  if (!Number.isFinite(firstSeen) || firstSeen <= 0) return null;
  const age = Math.floor(Date.now() / 1000) - firstSeen;
  if (age < LIFESAVER_ESCALATION_THRESHOLD_S) return null;
  return deny(
    `LIFESAVER ESCALATION (Bash blocked): agent-origin errors in log/hme-errors.log have been firing without resolution for ${age}s ` +
    `(threshold ${LIFESAVER_ESCALATION_THRESHOLD_S}s). Diagnose and fix the root cause. Bash unblocks automatically on the next ` +
    `inline-check (PostToolUse) that finds no new agent-origin errors above the watermark. To unblock fast: address the issue, ` +
    `then run any non-bash tool (Read/Grep/Edit) so the PostToolUse handler runs and clears the streak state.`,
  );
}

function createBashPolicyContext(input = {}, opts = {}) {
  const root = opts.projectRoot || PROJECT_ROOT;
  const next = { ...input };
  const cmd = String(next.command || next.cmd || '');
  return {
    input,
    opts,
    root,
    next,
    cmd,
    trimmed: cmd.trimStart().split('\n')[0],
    timeoutChanged: false,
  };
}

// Manual proxy/worker restart scripts are banned from Bash: zero-downtime
// auto-restart liveness is already tested and guaranteed (file_watcher +
// slot_watchdog converge slots to current code with routable_count never < 1).
const _RESTART_SCRIPT_RE = /(?:tools\/HME\/launcher\/[\w.-]+\.sh|polychron-(?:proxy-restart|slot-restart|launch|shutdown)\.sh|proxy-supervisor\.sh|codex-proxy-supervisor\.sh|universal-pulse-supervisor\.sh|proxy-watchdog\.sh|worker-restart\b|slot_watchdog\.js|file_watcher\.js|shuffler\.js)/;

const BASH_POLICIES = [
  { name: 'restart-script-ban', evaluate(ctx) {
    return _RESTART_SCRIPT_RE.test(ctx.cmd)
      ? deny('BLOCKED: proxy/worker auto-restart liveness is already tested and guaranteed (file_watcher + slot_watchdog auto-heal to current code, routable_count never drops below 1 -- zero downtime). Manual restart scripts are redundant churn; just edit code and let the supervisors converge.')
      : null;
  } },
  { name: 'lifesaver-escalation', evaluate(ctx) { return lifesaverEscalation(ctx.root); } },
  { name: 'noop-after-failure', evaluate(ctx) {
    const decision = noopAfterFailureDecision(ctx.cmd, ctx.root);
    if (decision) return decision;
    if (!isNoopCommand(ctx.cmd)) clearFailure(ctx.root);
    return null;
  } },
  { name: 'timeout-normalize', evaluate(ctx) {
    if (ctx.next.timeout && String(ctx.next.timeout) !== '0') delete ctx.next.timeout;
    ctx.timeoutChanged = !Object.prototype.hasOwnProperty.call(ctx.next, 'timeout') && Object.prototype.hasOwnProperty.call(ctx.input, 'timeout');
    return null;
  } },
  {
    name: 'remote-pipe-to-shell',
    evaluate(ctx) {
      return /\b(curl|wget|fetch)\b[^|]*\|\s*(\.\s+|sudo\s+|exec\s+)?(sh|bash|zsh|ksh|dash)\b/.test(ctx.cmd)
        ? deny('BLOCKED: piping a remote download into a shell interpreter is a supply-chain risk. Download, inspect, then execute deliberately.')
        : null;
    },
  },
  { name: 'lock-deletion', evaluate(ctx) {
    const ld = lockDeletion(ctx.cmd);
    return ld ? deny(`BLOCKED: Never delete ${LOCK_NAME} (matched: ${ld})`) : null;
  } },
  {
    name: 'mkdir-path-policy',
    evaluate(ctx) {
      if (!/\bmkdir\b/.test(ctx.cmd)) return null;
      if (mkdirHasMisplacedRootOnlyDir(ctx.cmd, ['log', 'tmp'])) return deny(rootOnlyDirMessage('mkdir'));
      if (mkdirHasMisplacedMetrics(ctx.cmd)) return deny(metricsMessage('mkdir metrics under', ctx.cmd));
      return null;
    },
  },
  {
    name: 'snapshot-gate',
    evaluate(ctx) {
      if (!/^npm run snapshot\b/.test(ctx.trimmed)) return null;
      let verdict = 'unknown';
      try { verdict = JSON.parse(fs.readFileSync(path.join(ctx.root, 'src/output/metrics/fingerprint-comparison.json'), 'utf8')).verdict || 'unknown'; } catch (_e) { /* silent-ok: missing fingerprint file denies snapshot. */ }
      return verdict !== 'STABLE' ? deny(`SNAPSHOT GATE: fingerprint verdict is ${verdict}, not STABLE. Diagnose or rerun until STABLE, then snapshot.`) : null;
    },
  },
  {
    name: 'pipeline-background',
    evaluate(ctx) {
      if (!/^(npm run (main|snapshot)|node (?:src\/)?lab\/run)/.test(ctx.trimmed)) return null;
      if (/\s&\s*$/.test(ctx.cmd)) return deny('BLOCKED: Do NOT use & for pipeline commands; use the host background/session mechanism instead.');
      if (ctx.opts.supportsRunInBackground === true && ctx.next.run_in_background !== true) {
        return deny('ANTI-WAIT: pipeline commands must use run_in_background=true in Claude Code; Codex/exec hosts do not expose that option.');
      }
      return null;
    },
  },
  { name: 'reader-guard', evaluate(ctx) { return readerGuard(ctx.cmd, ctx.root); } },
  {
    name: 'verify-landed',
    evaluate(ctx) { return verifyLanded(ctx.cmd, ctx.root) ? allow(setCommandInput(ctx.next, ':'), '', true) : null; },
  },
  {
    name: 'raw-command-rewrite',
    evaluate(ctx) {
      const enriched = rawCommandRewrite(ctx.cmd, ctx.root);
      return enriched ? allow(setCommandInput(ctx.next, enriched), '', true) : null;
    },
  },
  { name: 'feedback-kb-spam', evaluate(ctx) { return feedbackKbSpam(ctx.cmd); } },
  { name: 'log-first', evaluate(ctx) { return evaluateLogFirst(ctx.cmd, ctx.root); } },
  {
    name: 'pipeline-log-polling',
    evaluate(ctx) {
      return new RegExp(`(tail|cat|head|grep).*(r4[0-9]+_run|run\\.log|pipeline\\.log)|\\b${LOCK_NAME.replace('.', '\\.')}\\b`).test(ctx.cmd)
        ? deny(`BLOCKED: polling pipeline logs/${LOCK_NAME} is an antipattern. Run i/status, then continue other work.`)
        : null;
    },
  },
  {
    name: 'sleep-check',
    evaluate(ctx) {
      return /sleep.*(tail|cat|head|grep|\.output)/.test(ctx.cmd)
        ? allow(ctx.next, 'sleep+check detected. Background tasks notify on completion; avoid polling loops.', ctx.timeoutChanged)
        : null;
    },
  },
  { name: 'polling-counter', evaluate(ctx) { return pollingDecision(ctx.cmd, ctx.root); } },
  {
    name: 'fail-fast',
    evaluate(ctx) {
      if (/git commit/.test(ctx.cmd)) return null;
      const stripped = ctx.cmd.replace(/'[^']*'|"[^"]*"|`[^`]*`/g, ' ');
      return /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(function\s*\(\)|\([^)]*\)\s*=>)\s*\{\s*\}\)|(\btsc\b|\bnpm run\b|\bnode scripts\/|\beslint\b\s)[^|;&]*2>\/dev\/null/.test(stripped)
        ? deny('FAIL FAST VIOLATION -- silent error suppression detected. Errors must bubble or be explicitly logged.')
        : null;
    },
  },
  {
    name: 'i-tool-rewrite',
    evaluate(ctx) {
      if (!ctx.root || !new RegExp(`(^|[\\s;&|(])i/${I_TOOLS}\\b`).test(ctx.cmd)) return null;
      const cmd = ctx.cmd.replace(new RegExp(`(^|[\\s;&|(])i/${I_TOOLS}\\b`, 'g'), (_m, lead, tool) => `${lead}${ctx.root}/tools/HME/i/${tool}`);
      return allow(setCommandInput(ctx.next, cmd), '', true);
    },
  },
];

function evaluateBashInput(input = {}, opts = {}) {
  const ctx = createBashPolicyContext(input, opts);
  if (!ctx.cmd) return allow(ctx.next);
  for (const policy of BASH_POLICIES) {
    const result = policy.evaluate(ctx);
    if (result) return result;
  }
  return allow(ctx.next, '', ctx.timeoutChanged);
}

function toHookResponse(result, event = 'PreToolUse') {
  if (!result || (result.decision === 'allow' && !result.changed && !result.reason)) return '';
  if (result.decision === 'deny') return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: result.reason } });
  const hso = { hookEventName: event, permissionDecision: 'allow' };
  if (result.changed) hso.updatedInput = result.input;
  if (result.reason) hso.additionalContext = result.reason;
  return JSON.stringify({ hookSpecificOutput: hso });
}

module.exports = { evaluateBashInput, toHookResponse, blockedCommand, readerGuard, contextHit, lifesaverEscalation };
