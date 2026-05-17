'use strict';

const crypto = require('crypto');

function parseJson(raw) {
  try { return JSON.parse(raw || '{}'); }
  catch (err) { return {}; }
}

function unsupportedCodexPreToolDecision(value) {
  return value === 'allow' || value === 'ask' || value === 'approve';
}

function sanitizeHookSpecific(event, out) {
  if (!out || typeof out !== 'object') return out;
  const hso = out.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return out;
  delete hso.updatedInput;
  delete hso.updatedMCPToolOutput;
  delete hso.suppressOutput;
  delete hso.stopReason;
  if (!hso.hookEventName) hso.hookEventName = event;
  if (event === 'PreToolUse' && hso.permissionDecision === 'deny') {
    if (out.systemMessage === hso.permissionDecisionReason) delete out.systemMessage;
  }
  if ((event === 'PreToolUse' || event === 'PostToolUse') && unsupportedCodexPreToolDecision(hso.permissionDecision)) {
    if (hso.permissionDecisionReason && !hso.additionalContext) hso.additionalContext = hso.permissionDecisionReason;
    delete hso.permissionDecision;
    delete hso.permissionDecisionReason;
  }
  return out;
}

function decisionFields(parsed) {
  const hso = parsed && parsed.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return { decision: parsed && parsed.decision, reason: parsed && parsed.reason, channels: [] };
  const reason = hso.permissionDecisionReason
    || hso.additionalContext
    || (hso.decision && hso.decision.message)
    || (parsed && parsed.systemMessage)
    || '';
  const decision = hso.permissionDecision || (hso.decision && hso.decision.behavior) || parsed.decision || '';
  const channels = [];
  if (hso.permissionDecisionReason) channels.push('permissionDecisionReason');
  if (hso.additionalContext) channels.push('additionalContext');
  if (hso.decision && hso.decision.message) channels.push('decision.message');
  if (parsed && parsed.systemMessage) channels.push('systemMessage');
  return { decision, reason: String(reason || ''), channels };
}

function reasonHash(reason) {
  if (!reason) return '';
  return crypto.createHash('sha256').update(reason).digest('hex').slice(0, 12);
}

function systemReminder(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  if (/^<system-reminder>[\s\S]*<\/system-reminder>$/.test(s)) return s;
  return `<system-reminder>\n${s}\n</system-reminder>`;
}

function toPermissionRequestOutput(parsed) {
  const hso = parsed && parsed.hookSpecificOutput;
  if (!hso || typeof hso !== 'object') return sanitizeHookSpecific('PermissionRequest', parsed);
  const reason = hso.permissionDecisionReason || hso.additionalContext || parsed.systemMessage || '';
  if (hso.permissionDecision === 'deny') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: String(reason || 'HME policy denied this request') } } };
  }
  if (hso.permissionDecision === 'allow') {
    return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } }, ...(reason ? { systemMessage: String(reason) } : {}) };
  }
  if (reason) return { systemMessage: String(reason) };
  return {};
}

function sanitizeCodexStdout(event, stdout) {
  if (!stdout) return '';
  const trimmed = String(stdout).trim();
  if (!trimmed.startsWith('{')) return stdout;
  let parsed;
  try { parsed = JSON.parse(trimmed); }
  catch (err) { return stdout; }
  if (event === 'PermissionRequest') {
    const converted = toPermissionRequestOutput(parsed);
    return Object.keys(converted).length ? JSON.stringify(converted) : '';
  }
  if (event === 'PreToolUse' && parsed.decision === 'block' && parsed.reason) {
    return JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: parsed.reason } });
  }
  const sanitized = sanitizeHookSpecific(event, parsed);
  const emptyHso = sanitized.hookSpecificOutput
    && typeof sanitized.hookSpecificOutput === 'object'
    && Object.keys(sanitized.hookSpecificOutput).length === 1
    && sanitized.hookSpecificOutput.hookEventName;
  if (emptyHso) delete sanitized.hookSpecificOutput;
  return Object.keys(sanitized).length ? JSON.stringify(sanitized) : '';
}

function denyReason(stdout) {
  if (!stdout) return '';
  try {
    const parsed = JSON.parse(stdout);
    return parsed.reason
      || parsed.message
      || (parsed.hookSpecificOutput && parsed.hookSpecificOutput.permissionDecisionReason)
      || '';
  } catch (err) {
    return '';
  }
}

function claudeRelayFields(event, result) {
  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  let code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  if (stdout.includes('STREAK_RESET') || stderr.includes('BLOCKED: Raw tool streak')) {
    if (!stdout) stdout = 'NOTICE: My raw tool streak is too high. To continue, I must run an HME command such as `i/review mode=forget` or use native Read to refresh context.';
    stderr = 'Streak limit hit. Redirecting agent to HME tools.';
    code = 0;
  }
  if (event === 'PreToolUse' && code === 0) {
    const reason = denyReason(stdout);
    if (reason) {
      code = 2;
      stderr = reason;
    }
  }
  if (code === 0 && !stderr) stderr = ' ';
  return { stdout, stderr, exit_code: code };
}

module.exports = {
  parseJson,
  unsupportedCodexPreToolDecision,
  sanitizeHookSpecific,
  decisionFields,
  reasonHash,
  toPermissionRequestOutput,
  sanitizeCodexStdout,
  denyReason,
  claudeRelayFields,
};
