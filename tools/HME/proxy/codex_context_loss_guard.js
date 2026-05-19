'use strict';

const EMPTY_COMMAND_NOTICE = [
  'HME adapter notice: stripped a stale empty Bash tool result: no command was provided.',
  'This is adapter noise, not task context. Continue from the latest user request/session objective.',
].join('\n');

const CONTEXT_LOSS_NOTICE = [
  'HME context-loss guard: stripped a stale assistant response that treated an empty Bash tool error as the whole task.',
  'Use the latest user request/session objective instead of asking the user to resend context.',
].join('\n');

const REPAIR_PROMPT_PREFIX = 'HME context-loss repair';
const MISSING_REQUIRED_RE = /\bError:\s*(?:command|prompt|url|file_path|old_string|new_string|content|query) is required(?:\s+for\s+[A-Za-z]+)?\.?\b/i;
const EMPTY_COMMAND_RE = /\bError:\s*command is required(?:\s+for\s+Bash)?\.?\b/i;
const ADAPTER_NOTICE_RE = /\b(?:HME\s+)?adapter notices?\b|\bignored an empty Bash tool call\b|\bempty Bash tool(?:-| )?result\b|\bstale empty Bash tool result\b|\brecovered tool context\b/i;
const RECOVERED_RE = /\b(?:only\s+(?:have\s+)?(?:the\s+)?)?recovered\s+(?:adapter\s+notices?|tool\s+)?(?:result|context|state|notices?)\b/i;
const NO_CONTEXT_RE = /\b(?:no actual context apart from a failed call|no additional actionable project context|nothing useful came from it|failed invocation due to a missing command|not the actual prior task\/session objective|don[’']t contain actionable project context|do not contain actionable project context)\b/i;
const ASK_RESEND_RE = /\bplease\s+(?:send|provide)\s+(?:the\s+)?(?:current\s+objective|actual\s+)?(?:task|command|goal|file|bug|repository goal|instructions?|objective|prior task details?)\b/i;
const NO_ACTION_RE = /\b(?:no command was executed|no files were read or modified|there(?:'s| is) no additional actionable|won[’']t repeat the empty Bash calls)\b/i;
const META_STALL_RE = /\bI need to handle the situation where the user expects me to continue\b/i;

function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.output === 'string') return value.output;
  if (typeof value.content === 'string') return value.content;
  return '';
}

function hasEmptyCommandError(text) {
  return EMPTY_COMMAND_RE.test(String(text || ''));
}

function hasMissingRequiredToolError(text) {
  return MISSING_REQUIRED_RE.test(String(text || ''));
}

function isContextLossText(text) {
  const s = String(text || '');
  if (!s.trim()) return false;
  const mentionsEmptyCommand = hasMissingRequiredToolError(s);
  const mentionsAdapterNotice = ADAPTER_NOTICE_RE.test(s);  const recovered = RECOVERED_RE.test(s);
  const noContext = NO_CONTEXT_RE.test(s);
  const asksResend = ASK_RESEND_RE.test(s);
  const noAction = NO_ACTION_RE.test(s);
  const metaStall = META_STALL_RE.test(s);
  const adapterAnchor = mentionsEmptyCommand || mentionsAdapterNotice;
  return (adapterAnchor && (recovered || noContext || asksResend || noAction || metaStall))
    || ((recovered || noContext || metaStall) && asksResend);
}

function bump(stats, key) {
  stats.scrubbed = (stats.scrubbed || 0) + 1;
  stats.categories = stats.categories || {};
  stats.categories[key] = (stats.categories[key] || 0) + 1;
}

function scrubText(text, stats, ctx) {
  const raw = String(text || '');
  if (ctx.inToolOutput && hasMissingRequiredToolError(raw)) {
    bump(stats, 'missing_required_tool_output');
    return EMPTY_COMMAND_NOTICE;
  }
  if (ctx.scrubAssistantText && !ctx.protectedUser && isContextLossText(raw)) {
    bump(stats, 'assistant_context_loss_text');
    return CONTEXT_LOSS_NOTICE;
  }
  return text;
}

function scrubCodexContextLossNoise(value, stats = {}, ctx = {}) {
  if (typeof value === 'string') return scrubText(value, stats, ctx);
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => scrubCodexContextLossNoise(item, stats, ctx));

  const type = String(value.type || '');
  const role = String(value.role || ctx.role || '');
  const isToolOutput = type === 'function_call_output' || type === 'tool_result';
  const protectedUser = ctx.protectedUser || role === 'user';
  const scrubAssistantText = ctx.scrubAssistantText || role === 'assistant' || type === 'output_text';
  const out = {};

  for (const [key, child] of Object.entries(value)) {
    const childCtx = {
      role,
      protectedUser,
      scrubAssistantText: scrubAssistantText || (key === 'content' && role === 'assistant') || type === 'output_text',
      inToolOutput: ctx.inToolOutput || isToolOutput || (isToolOutput && (key === 'output' || key === 'content')),
    };
    out[key] = scrubCodexContextLossNoise(child, stats, childCtx);
  }
  return out;
}

function collectStrings(value, out = [], ctx = {}) {
  if (typeof value === 'string') {
    if (ctx.responseText) out.push(value);
    return out;
  }
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out, ctx);
    return out;
  }
  const type = String(value.type || '');
  const role = String(value.role || ctx.role || '');
  const responseText = ctx.responseText || role === 'assistant' || type === 'message' || type === 'output_text' || type === 'text';
  for (const [key, child] of Object.entries(value)) {
    collectStrings(child, out, { role, responseText: responseText || key === 'text' || key === 'content' });
  }
  return out;
}

function responseHasContextLoss(value) {
  const text = typeof value === 'string' ? value : collectStrings(value).join('\n');
  return isContextLossText(text);
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (typeof block === 'string') return block;
    if (!block || typeof block !== 'object') return '';
    if (typeof block.text === 'string') return block.text;
    if (typeof block.content === 'string') return block.content;
    return '';
  }).filter(Boolean).join('\n');
}

function latestUserTaskText(body) {
  const hits = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value.role === 'user') {
      const text = contentText(value.content || value.input || value.text);
      if (text && !hasEmptyCommandError(text)) hits.push(text);
    }
    for (const child of Object.values(value)) visit(child);
  }
  if (typeof body?.input === 'string' && body.input.trim() && !hasEmptyCommandError(body.input)) hits.push(body.input);
  visit(body?.input);
  visit(body?.messages);
  const latest = hits[hits.length - 1] || '';
  return latest.length > 4000 ? latest.slice(-4000) : latest;
}

function repairPrompt(body) {
  const latest = latestUserTaskText(body);
  return [
    `${REPAIR_PROMPT_PREFIX}: the previous assistant response incorrectly treated a stale empty Bash tool-result error as the whole task.`,
    'Ignore raw or recovered tool results that only report missing required tool fields, such as “Error: command is required” or “Error: prompt is required”. They are adapter noise.',
    'Do not ask the user to resend the task solely because of that empty-command error.',
    'Continue directly from the latest user request/session objective and make the next useful change.',
    latest ? `\nLatest user request/session objective:\n${latest}` : '',
  ].filter(Boolean).join('\n');
}

function appendContextLossRepair(body) {
  const prompt = repairPrompt(body);
  const next = { ...(body || {}) };
  if (Array.isArray(next.input)) {
    next.input = [...next.input, { role: 'user', content: [{ type: 'input_text', text: prompt }] }];
  } else if (typeof next.input === 'string') {
    next.input = `${next.input}\n\n${prompt}`;
  } else if (Array.isArray(next.messages)) {
    next.messages = [...next.messages, { role: 'user', content: prompt }];
  } else {
    next.input = [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }];
  }
  return next;
}

function contextLossFallbackResponse(parsed) {
  return {
    id: parsed && parsed.id ? parsed.id : `hme_context_loss_${Date.now()}`,
    object: 'response',
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{
        type: 'output_text',
        text: 'HME blocked a Codex context-loss response that treated an empty Bash tool error as the task. Continue from the latest user request/session objective; do not ask the user to resend context because of “Error: command is required”.',
      }],
    }],
    hme_context_loss_blocked: true,
  };
}

module.exports = {
  EMPTY_COMMAND_NOTICE,
  CONTEXT_LOSS_NOTICE,
  REPAIR_PROMPT_PREFIX,
  hasEmptyCommandError,
  isContextLossText,
  scrubCodexContextLossNoise,
  responseHasContextLoss,
  latestUserTaskText,
  appendContextLossRepair,
  contextLossFallbackResponse,
};
