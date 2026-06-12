'use strict';

function _textFromContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => {
    if (!b || typeof b !== 'object') return '';
    if (b.type === 'text') return b.text || '';
    if (b.type === 'tool_result') return String(b.content || '');
    return '';
  }).filter(Boolean).join('\n');
}

function isGoalStopVerifierPayload(payload) {
  const msgs = (payload && payload.messages) || [];
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') return false;
  const text = _textFromContent(last.content);
  return /Based on the conversation transcript above, has the following stopping condition been satisfied\?/i.test(text)
    && /Answer based on transcript evidence only\./i.test(text)
    && /Condition:/i.test(text)
    && /ARGUMENTS:/i.test(text);
}

function normalizeGoalVerifierText(text) {
  const raw = String(text || '').trim();
  if (!raw) return JSON.stringify({ ok: false, reason: 'Goal verifier returned an empty verdict.' });
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      if (typeof parsed.ok === 'boolean') return JSON.stringify({ ok: parsed.ok, ...(parsed.reason ? { reason: String(parsed.reason) } : {}) });
      if (typeof parsed.continue === 'boolean') return JSON.stringify({ ok: !parsed.continue, ...(parsed.reason ? { reason: String(parsed.reason) } : {}) });
    }
  } catch (_e) { /* prose verdict; normalize below */ }
  const yes = /^(yes|true|satisfied)\b/i.test(raw) || /\b(has been|is)\s+satisfied\b/i.test(raw);
  const no = /^(no|false|not satisfied|unsatisfied)\b/i.test(raw) || /\bnot\s+(?:been\s+)?satisfied\b/i.test(raw) || /\bcondition\s+(?:has\s+)?not\b/i.test(raw);
  const ok = yes && !no;
  return JSON.stringify({ ok, reason: raw });
}

function goalVerifierSseRewrite(eventName, data, ctx) {
  if (!ctx.get('goalVerifier')) return data;
  if (eventName !== 'content_block_delta' || !data || !data.delta || data.delta.type !== 'text_delta') return data;
  ctx.set('goalVerifierText', String(ctx.get('goalVerifierText') || '') + String(data.delta.text || ''));
  return null;
}

function goalVerifierSseFlush(eventName, data, ctx) {
  if (!ctx.get('goalVerifier')) return data;
  if (eventName !== 'content_block_stop') return data;
  const text = String(ctx.get('goalVerifierText') || '');
  const normalized = normalizeGoalVerifierText(text);
  ctx.set('goalVerifierText', '');
  return { events: [
    ['content_block_delta', { type: 'content_block_delta', index: data.index, delta: { type: 'text_delta', text: normalized } }],
    ['content_block_stop', data],
  ] };
}

module.exports = { isGoalStopVerifierPayload, normalizeGoalVerifierText, goalVerifierSseRewrite, goalVerifierSseFlush };
