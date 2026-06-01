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

module.exports = {
  couldBeStructuredJsonText,
  isStructuredJsonText,
  shouldBypassResponseTextRewrite,
};
