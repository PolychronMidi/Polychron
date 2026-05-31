'use strict';

function isStructuredJsonText(text) {
  const t = String(text || '').trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return false;
  try { JSON.parse(t); return true; } catch (_e) { return false; }
}

function shouldBypassResponseTextRewrite(text) {
  return isStructuredJsonText(text);
}

module.exports = {
  isStructuredJsonText,
  shouldBypassResponseTextRewrite,
};
