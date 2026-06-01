'use strict';

function cleanLine(line) {
  return String(line || '').replace(/^\s*(?:[│|]\s*)?/, '');
}

function markerFromBrokenRead(line) {
  const m = /^Read\(\{"file_path":"<<['"]?([A-Za-z0-9_:-]+)['"]?"\}\)$/.exec(cleanLine(line).trim());
  return m ? m[1] : '';
}

function jsonPayload(lines) {
  try {
    const parsed = JSON.parse(lines.map(cleanLine).join('\n').trim());
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_e) { return null; }
}

function readInput(raw) {
  if (!raw || typeof raw !== 'object' || !raw.file_path) return null;
  const out = { file_path: String(raw.file_path) };
  for (const key of ['offset', 'limit', 'tail']) {
    if (raw[key] == null || raw[key] === '') continue;
    const n = Number(raw[key]);
    if (Number.isFinite(n)) out[key] = n;
  }
  if (raw.pages != null) out.pages = String(raw.pages);
  return out;
}

function rewriteBrokenReadDisplays(text, format, stats = {}) {
  const src = String(text || '');
  if (!src.includes('HME_CODEX_JSON') || !src.includes('Read({"file_path":"<<')) return src;
  const lines = src.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const marker = markerFromBrokenRead(lines[i]);
    if (!marker) { out.push(lines[i]); continue; }
    const payload = [];
    while (i + 1 < lines.length) {
      const next = lines[++i];
      if (cleanLine(next).trim() === marker) break;
      payload.push(next);
    }
    const input = readInput(jsonPayload(payload));
    out.push(input ? format({ tool: 'Read', input }) : 'Read');
    stats.text_rewrites = (stats.text_rewrites || 0) + 1;
  }
  return out.join('\n');
}

function repairMalformedNativeCall(name, payload) {
  if (name !== 'Read' || !payload || typeof payload !== 'object') return null;
  const raw = typeof payload.file_path === 'string' ? payload.file_path.trim() : '';
  const m = /^<<['"]?([A-Za-z0-9_:-]+)['"]?\r?\n([\s\S]*?)\r?\n\1$/.exec(raw);
  if (!m) return null;
  const input = readInput(jsonPayload([m[2]]));
  return input ? { tool: 'Read', input } : null;
}

module.exports = { rewriteBrokenReadDisplays, repairMalformedNativeCall };
