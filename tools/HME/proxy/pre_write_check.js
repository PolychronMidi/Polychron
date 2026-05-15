'use strict';
const fs = require('fs');
const path = require('path');
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
