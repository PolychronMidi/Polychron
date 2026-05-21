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

function parseJsonSequence(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] !== '{') return null;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < s.length; i++) {
      const ch = s[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    if (depth !== 0 || inString) return null;
    try { out.push(JSON.parse(s.slice(start, i))); }
    catch (_err) { return null; }
  }
  return out;
}

function pushText(list, value) {
  const s = String(value || '').trim();
  if (s && !list.includes(s)) list.push(s);
}

function renderCodexUserPromptSubmit(items) {
  const contexts = [];
  const reasons = [];
  let block = false;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const hso = item.hookSpecificOutput && typeof item.hookSpecificOutput === 'object' ? item.hookSpecificOutput : {};
    pushText(contexts, hso.additionalContext);
    pushText(contexts, hso.permissionDecisionReason);
    pushText(contexts, hso.decision && hso.decision.message);
    pushText(contexts, item.systemMessage);
    const decision = item.decision || hso.permissionDecision || (hso.decision && hso.decision.behavior) || '';
    if (decision === 'block' || decision === 'deny') {
      block = true;
      pushText(reasons, item.reason);
      pushText(reasons, hso.permissionDecisionReason || hso.additionalContext || item.systemMessage);
    }
  }
  const out = {};
  if (contexts.length) out.hookSpecificOutput = { hookEventName: 'UserPromptSubmit', additionalContext: contexts.join('\n\n') };
  if (block) {
    out.decision = 'block';
    out.reason = reasons[0] || contexts.join('\n\n') || 'Blocked by UserPromptSubmit hook.';
  }
  return Object.keys(out).length ? JSON.stringify(out) : '';
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
  catch (err) {
    const seq = event === 'UserPromptSubmit' ? parseJsonSequence(trimmed) : null;
    return seq && seq.length ? renderCodexUserPromptSubmit(seq) : stdout;
  }
  if (event === 'UserPromptSubmit') return renderCodexUserPromptSubmit([parsed]);
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

function isBenignHookStderr(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) => /^ok$/i.test(line));
}

function claudeRelayFields(event, result) {
  let stdout = result.stdout || '';
  let stderr = result.stderr || '';
  let code = Number.isInteger(result.exit_code) ? result.exit_code : 0;
  if (isBenignHookStderr(stderr)) stderr = '';
  if (event === 'Stop' && code === 0 && stdout) {
    const parsed = parseJson(stdout);
    if (parsed && parsed.decision === 'block' && parsed.reason && !stderr) {
      stderr = ' ';
    }
  }
  if (event === 'PreToolUse' && code === 0 && stdout) {
    const parsed = parseJson(stdout);
    if (parsed && parsed.decision === 'block' && parsed.reason) {
      stdout = JSON.stringify({ hookSpecificOutput: { hookEventName: event, permissionDecision: 'deny', permissionDecisionReason: parsed.reason } });
    }
    const fields = decisionFields(parseJson(stdout));
    if (fields.decision === 'deny' && /^\s*ok\s*$/i.test(stderr || '')) stderr = '';
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
  isBenignHookStderr,
  claudeRelayFields,
};
