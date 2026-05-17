'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const registry = require('../policies/registry');
const config = require('../policies/config');
const stateClient = require('./session_state_client');
const { normalize } = require('../event_kernel/envelope');
const { PROJECT_ROOT } = require('./shared');
const {
  isMisplacedRootOnlyDir,
  isMisplacedMetricsPath,
  rootOnlyDirMessage,
  metricsMessage,
} = require('./path_policy');

function _permission(decision, reason = '', context = '') {
  return { permissionDecision: decision, reason, contextualRules: context ? [context] : [] };
}

function _loadPolicies() {
  registry.loadBuiltins();
  const cfg = config.get();
  if (cfg.customPoliciesPath) {
    const customPath = path.isAbsolute(cfg.customPoliciesPath)
      ? cfg.customPoliciesPath
      : path.join(PROJECT_ROOT, cfg.customPoliciesPath);
    registry.loadCustom(customPath);
  }
}

function _content(payload) {
  const input = payload.tool_input || {};
  return payload.tool_name === 'Write' ? (input.content || '') : (input.new_string || '');
}

function _denyIf(condition, reason) {
  return condition ? _permission('deny', reason) : null;
}

function _badPathShape(file) {
  const s = String(file ?? '');
  return !s.trim() || /[\r\n]/.test(s) || s.trim().startsWith('<<') || /HME_CODEX_JSON|[{}]/.test(s);
}

function _editShapeDecision(payload) {
  if (payload.tool_name !== 'Edit') return null;
  const input = payload.tool_input || {};
  const file = input.file_path || '';
  if (_badPathShape(file)) return _permission('deny', `BLOCKED: malformed Edit file_path: ${String(file || '(empty)').slice(0, 120)}`);
  if (typeof input.old_string !== 'string' || input.old_string.length === 0) return _permission('deny', 'BLOCKED: malformed Edit missing old_string. Use exact current file text.');
  if (typeof input.new_string !== 'string') return _permission('deny', 'BLOCKED: malformed Edit missing new_string.');
  if (/<display-redacted:|<omitted by proxy>/i.test(input.old_string) || /<display-redacted:|<omitted by proxy>/i.test(input.new_string)) {
    return _permission('deny', 'BLOCKED: Edit text is display-redacted. Re-read current file text, then retry with actual old_string/new_string.');
  }
  if (input.old_string === input.new_string) return _permission('deny', 'BLOCKED: Edit old_string equals new_string; this is a no-op/false-success risk. Use a real replacement or stop if no change is needed.');
  return null;
}

function _editCurrentFileDecision(payload) {
  if (payload.tool_name !== 'Edit' || payload._hme_synthetic_tool) return null;
  const input = payload.tool_input || {};
  const file = input.file_path || '';
  try {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return _permission('deny', `BLOCKED: Edit target is not an existing file: ${String(file).slice(0, 160)}`);
    const current = fs.readFileSync(file, 'utf8');
    if (!current.includes(input.old_string)) {
      if (input.new_string && current.includes(input.new_string)) {
        return _permission('deny', 'BLOCKED: Edit old_string is absent and new_string is already present. The change appears already applied; do not trust a native Edit success here.');
      }
      return _permission('deny', 'BLOCKED: Edit old_string is absent from current file. Re-read current file text, then retry with an exact old_string.');
    }
  } catch (err) {
    return _permission('deny', `BLOCKED: Edit preflight could not read target: ${err.message}`);
  }
  return null;
}


function _commentBloatDecision(file, content, writeVerb) {
  const fp = String(file || '').toLowerCase();
  const prefixes = /\.(js|ts|jsx|tsx|mjs|cjs)$/.test(fp) ? ['//'] : /\.(py|sh|bash|yaml|yml|toml)$/.test(fp) ? ['#'] : [];
  if (!prefixes.length) return null;
  const threshold = Number(process.env.COMMENT_BLOAT_WARN || 3);
  const longLine = Number(process.env.COMMENT_BLOAT_LONG_LINE || 90);
  const annotations = ['# rationale:', '# silent-ok:', '# TODO:', '# FIXME:', '# noqa', '# pylint:', '# pyright:', '# type:', '// rationale:', '// silent-ok:', '// TODO:', '// FIXME:', '// eslint-', '// noqa'];
  let run = 0;
  for (const line of String(content || '').split('\n')) {
    const t = line.trimStart();
    if (prefixes.some((p) => t.startsWith(p)) && !t.startsWith('#!')) {
      if (line.length >= longLine) return _permission('deny', `BLOCKED: ${writeVerb} content contains a comment line of ${line.length} chars (>= ${longLine}). Long rationale belongs in doc/.`);
      if (!annotations.some((a) => t.startsWith(a))) {
        run += 1;
        if (run >= threshold) return _permission('deny', `BLOCKED: ${writeVerb} content contains a ${run}-line consecutive inline-comment block. Trim to <=2 lines OR move prose into doc/.`);
      } else run = 0;
    } else run = 0;
  }
  return null;
}

function _runTddGate(file) {
  if (!file) return null;
  const script = path.join(PROJECT_ROOT, 'tools/HME/scripts/tdd_test_first_gate.py');
  if (!fs.existsSync(script)) return null;
  try { execFileSync('python3', [script, '--file', file], { cwd: PROJECT_ROOT, env: { ...process.env, PROJECT_ROOT }, encoding: 'utf8', stdio: 'pipe' }); }
  catch (err) { return _permission('deny', String(err.stderr || err.stdout || err.message || 'TDD test-first gate failed').slice(0, 800)); }
  return null;
}

function _decisionAudit(file) {
  if (!/(CLAUDE\.md|doc\/templates\/TODO\.md|\.claude\/agents\/.*\.md|tools\/HME\/scripts\/detectors\/.*\.py|tools\/HME\/proxy\/stop_chain\/policies\/.*\.js)$/.test(file || '')) return;
  try {
    const log = path.join(PROJECT_ROOT, 'src/output/metrics/decision-audit.jsonl');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, JSON.stringify({ ts: new Date().toISOString(), file, reviewed: false, consulted: false, skip_reason: '' }) + '\n');
  } catch (_err) { /* silent-ok: optional audit sink. */ }
}

function _backgroundWarningDecision(file, content) {
  if (!String(file || '').includes('tools/HME/service/server')) return null;
  if (/logger\.warning\(.*\b(background|warm.*fail|warm.*error|onnx.*failed|VRAM TIGHT|lazy warm)\b/.test(content || '')) {
    return _permission('deny', 'BLOCKED: Expected background failure logged as WARNING -- use logger.info. Only critical failures should be WARNING in HME server.');
  }
  return null;
}

function _moduleName(file) { return path.basename(String(file || '')).replace(/\.[^.]*$/, ''); }
function _workerValidate(moduleName, timeoutMs = 600) {
  return new Promise((resolve) => {
    if (!moduleName) return resolve(null);
    const port = process.env.HME_WORKER_PORT || '9098';
    const body = JSON.stringify({ query: moduleName });
    const req = http.request({ hostname: '127.0.0.1', port, path: '/validate', method: 'POST', timeout: timeoutMs, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (_err) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function _kbBugfixDecision(file, content, writeVerb) {
  if (!String(file || '').includes('/Polychron/src/') || String(content || '').length <= 20) return null;
  const data = await _workerValidate(_moduleName(file));
  const blocks = Array.isArray(data && data.blocks) ? data.blocks : [];
  const hit = blocks.find((b) => typeof b.score === 'number' && b.score >= 0.6);
  if (!hit) return null;
  return _permission('deny', `BLOCKED: KB has a bugfix entry "${String(hit.title || '').slice(0, 120)}" strongly matching this module. Review with learn(query='${_moduleName(file)}') before ${writeVerb.toLowerCase()}ing.`);
}

function _shellParityDecision(payload) {
  const input = payload.tool_input || {};
  const file = input.file_path || '';
  const content = _content(payload);
  const base = path.basename(file || '');
  const writeVerb = payload.tool_name === 'Write' ? 'Write' : 'Edit';
  const srcPath = file.includes('/Polychron/src/');

  const runLock = path.join(PROJECT_ROOT, 'tmp', 'run.lock');
  let d = _denyIf(
    fs.existsSync(runLock) && srcPath,
    `ABANDONED PIPELINE: npm run main is running (tmp/run.lock present). Do NOT ${writeVerb.toLowerCase()} src/ code mid-pipeline -- the pipeline's behavior is being measured against the code state at launch. Wait for completion; use HME tools or edit tooling/docs in the meantime.`
  );
  if (d) return d;

  d = _denyIf(isMisplacedRootOnlyDir(file, ['log', 'tmp']),
    rootOnlyDirMessage(writeVerb.toLowerCase()));
  if (d) return d;

  d = _denyIf(isMisplacedMetricsPath(file),
    metricsMessage('write files in', file));
  if (d) return d;

  d = _denyIf(/^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$|\.(pem|key|pfx|p12|jks)$|^credentials(\.json)?$|^service[-_]account.*\.json$|^\.npmrc$|^\.pypirc$|^\.netrc$/i.test(base),
    `BLOCKED: writing to a credential filename (${base}). Polychron does not store keys, certs, or auth tokens in the repo. If this is a test fixture, name it with a non-credential prefix (e.g. fixture-*.pem); if it's an accidental real key, do NOT proceed.`);
  if (d) return d;

  _decisionAudit(file);

  d = _runTddGate(file);
  if (d) return d;

  d = _commentBloatDecision(file, content, writeVerb);
  if (d) return d;

  d = _backgroundWarningDecision(file, content);
  if (d) return d;

  const rootInContent = PROJECT_ROOT && content.includes(PROJECT_ROOT);
  const sourceFile = /\.(sh|py|js|ts|tsx|mjs|cjs|json|yaml|yml|md)$/.test(file);
  const rootJson = new RegExp('"PROJECT_ROOT":[^,}]*"' + PROJECT_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"').test(content);
  const rootExempt = /(\/\.env(\.[a-z]+)?$|\/README(\.[a-z]+)?$|\/CLAUDE\.md$|\/tools\/HME\/KB\/devlog\/|\/doc\/[^/]+\.md$|\/doc\/archive\/)/.test(file);
  d = _denyIf(rootInContent && sourceFile && !rootJson && !rootExempt,
    `BLOCKED: ${writeVerb} content contains hardcoded project root '${PROJECT_ROOT}'. Use $PROJECT_ROOT or $CLAUDE_PROJECT_DIR -- never a host-specific path.`);
  if (d) return d;

  d = _denyIf(/(api[_-]?key|password|secret|token)[\s]*[:=][\s]*[A-Za-z0-9+/]{20,}/i.test(content),
    'BLOCKED: Potential secret/credential detected in write content. Review before writing.');
  if (d) return d;

  d = _denyIf(/(#|\/\/|\/\*)\s*(\.\.\.)?\s*(existing|rest of|previous)\s+(code|file|implementation|content|functions?)\s*(\.\.\.)?/i.test(content),
    `BLOCKED: ${writeVerb} content contains comment-ellipsis stub placeholder. Use the ACTUAL content -- no stubs.`);
  if (d) return d;

  if (/\.py$/.test(file) && /except[^:\n]*:\s*\n[ \t]*pass\b/.test(content) && !/silent-ok/.test(content)) {
    return _permission('deny', "BLOCKED: content contains naked 'except: pass' without '# silent-ok: <reason>' annotation. CONSTITUTION rule 3 requires propagating errors or naming why silence is safe.");
  }

  const spam = content.split('\n').find((line) => !line.includes('spam-ok') && /([^\w\s()[\]{}])\1{3,}/.test(line));
  if (spam) return _permission('deny', 'BLOCKED: content contains a run of 4+ identical decoration characters. Use plain text or append spam-ok where genuinely required.');

  if (srcPath) {
    if (/\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]/.test(content)) return _permission('deny', 'BLOCKED: content uses global. or globalThis. -- reference the declared global directly.');
    if (/\|\|\s*(0|\[\]|\{})([^a-zA-Z0-9_]|$)/.test(content)) return _permission('deny', 'BLOCKED: content uses || fallback -- use validator checks/fail-fast handling.');
    if (/\.getSnapshot\(\)\s*\.\s*couplingMatrix/.test(content)) return _permission('deny', 'BLOCKED: content reads .couplingMatrix off getSnapshot() -- register a bias instead.');
    if (/\bconsole\.warn\b/.test(content) && !/console\.warn\([^)]*['"]Acceptable warning:/.test(content)) return _permission('deny', "BLOCKED: console.warn without 'Acceptable warning:' prefix.");
    if (/setBinaural\s*\(\s*([0-7](\.[0-9]+)?|1[3-9]|[2-9][0-9])\b/.test(content)) return _permission('deny', 'BLOCKED: setBinaural called outside alpha range 8-12Hz.');
  }

  return _permission('allow');
}

async function preWriteCheck(stdinJson) {
  const env = normalize(stdinJson);
  const payload = { ...env.raw, session_id: env.session_id, tool_name: env.tool_name, tool_input: env.tool_input };
  const tool = payload.tool_name || '';
  if (!['Write', 'Edit', 'MultiEdit'].includes(tool)) return _permission('allow');
  const shapeDecision = _editShapeDecision(payload);
  if (shapeDecision) return shapeDecision;

  try {
    _loadPolicies();
    const policies = registry.matchingFor('PreToolUse', tool, config);
    const ctx = {
      toolInput: payload.tool_input || {},
      toolName: tool,
      sessionId: payload.session_id || '',
      payload,
      deny: registry.deny,
      instruct: registry.instruct,
      allow: registry.allow,
      params: {},
    };
    const { firstDeny, instructs, errors } = await registry.runChain(policies, ctx);
    if (firstDeny) {
      const out = _permission('deny', firstDeny.reason, `policy:${firstDeny.policy}`);
      await stateClient.call('write', payload.session_id || '', { payload, decision: out });
      return out;
    }
    if (errors.length) return _permission('ask', errors.map((e) => `${e.policy}: ${e.error}`).join('\n'));
    const shellDecision = _shellParityDecision(payload);
    if (shellDecision.permissionDecision !== 'allow') {
      await stateClient.call('write', payload.session_id || '', { payload, decision: shellDecision });
      return shellDecision;
    }
    const editCurrentDecision = _editCurrentFileDecision(payload);
    if (editCurrentDecision) {
      await stateClient.call('write', payload.session_id || '', { payload, decision: editCurrentDecision });
      return editCurrentDecision;
    }
    const kbDecision = await _kbBugfixDecision((payload.tool_input || {}).file_path || '', _content(payload), tool === 'Write' ? 'Write' : 'Edit');
    if (kbDecision) {
      await stateClient.call('write', payload.session_id || '', { payload, decision: kbDecision });
      return kbDecision;
    }
    if (instructs.length) shellDecision.contextualRules.push(...instructs.map((i) => i.message));
    await stateClient.call('write', payload.session_id || '', { payload, decision: shellDecision });
    return shellDecision;
  } catch (err) {
    // silent-ok: optional fallback path.
    return _permission('ask', `pre-write-check failed: ${err.message}`);
  }
}

function toHookResponse(decision) {
  if (decision.permissionDecision === 'deny') {
    return JSON.stringify({ hookSpecificOutput: { permissionDecision: 'deny', permissionDecisionReason: decision.reason } });
  }
  if (decision.permissionDecision === 'ask') {
    return JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: decision.reason } });
  }
  if (decision.contextualRules && decision.contextualRules.length) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', additionalContext: decision.contextualRules.join('\n\n') } });
  }
  return '';
}

module.exports = { preWriteCheck, toHookResponse };
