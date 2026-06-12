'use strict';

function couldBeStructuredJsonText(text) {
  const t = String(text || '').trimStart();
  return !t || t[0] === '{' || t[0] === '[';
}

function isStructuredJsonText(text) {
  const t = String(text || '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false;
  try { JSON.parse(t); return true; } catch (_e) { return false; }
}

function shouldBypassResponseTextRewrite(text) {
  return isStructuredJsonText(text);
}

function normalizeStructuredJsonText(text) {
  if (!isStructuredJsonText(text)) return String(text || '');
  let parsed;
  try { parsed = JSON.parse(String(text).trim()); }
  catch (_e) { return String(text || ''); }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      && typeof parsed.ok !== 'boolean' && typeof parsed.continue === 'boolean') {
    const reason = typeof parsed.reason === 'string' ? parsed.reason
      : typeof parsed.rsn === 'string' ? parsed.rsn
      : '';
    return JSON.stringify({ ok: !parsed.continue, ...(reason ? { reason } : {}) });
  }
  return String(text || '');
}

module.exports = {
  couldBeStructuredJsonText,
  isStructuredJsonText,
  normalizeStructuredJsonText,
  shouldBypassResponseTextRewrite,
};
