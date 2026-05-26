'use strict';

const fs = require('fs');

// anti-fork-begin: hook-inject-prefixes min=7
const HOOK_INJECT_PREFIXES = [
  'Stop hook feedback:',
  'AUTO-COMPLETENESS INJECT',
  '[ALERT] LIFESAVER',
  'NEXUS --',
  '[[HME_AGENT_TASK',
  'PreToolUse:',
  'PostToolUse:',
];
// anti-fork-end: hook-inject-prefixes


function lastAssistantText(transcriptPath) {
  if (!transcriptPath) return '';
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return ''; }
  let last = '';
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'assistant') continue;
    const content = (entry.message && entry.message.content) || entry.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join(' ');
    }
    text = text.trim();
    if (text) last = text;
  }
  return last;
}

// Count assistant tool_use blocks since the most recent user prompt in the
// transcript. The completeness gate uses this to decide whether the model
function assistantToolUsesSinceLastUserPrompt(transcriptPath) {
  if (!transcriptPath) return 0;
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return 0; }
  let lastUserIdx = -1;
  const entries = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]) continue;
    let entry;
    try { entry = JSON.parse(lines[i]); } catch (_e) { continue; }
    entries.push(entry);
    const role = entry.type || entry.role;
    if (role === 'user') {
      const text = _entryText(entry);
      if (text && !/^\[SYSTEM NOTIFICATION/.test(text) && !/^Stop hook feedback:/.test(text)) {
        lastUserIdx = entries.length - 1;
      }
    }
  }
  if (lastUserIdx < 0) return 0;
  let count = 0;
  for (let i = lastUserIdx + 1; i < entries.length; i++) {
    const entry = entries[i];
    const role = entry.type || entry.role;
    if (role !== 'assistant') continue;
    count += _assistantToolUses(entry).length;
  }
  return count;
}

function entryTimestampMs(entry) {
  const raw = entry && (entry.timestamp || entry.created_at || entry.time || entry.ts);
  if (typeof raw === 'number') return raw > 10_000_000_000 ? raw : raw * 1000;
  const parsed = Date.parse(String(raw || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function lastRealUserPrompt(transcriptPath) {
  if (!transcriptPath) return { text: '', turnIndex: 0, tsMs: 0 };
  let lines;
  try { lines = fs.readFileSync(transcriptPath, 'utf8').split('\n'); }
  catch (_e) { return { text: '', turnIndex: 0, tsMs: 0 }; }
  let last = '';
  let lastTurnIndex = 0;
  let lastTsMs = 0;
  let turnIndex = 0;
  for (const line of lines) {
    if (!line) continue;
    let entry;
    try { entry = JSON.parse(line); } catch (_e) { continue; }
    const role = entry.type || entry.role;
    if (role !== 'user') continue;
    const content = (entry.message && entry.message.content) || entry.content;
    let text = '';
    if (typeof content === 'string') {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b) => b && b.type === 'text')
        .map((b) => b.text || '')
        .join(' ');
    }
    text = text.trim();
    if (!text) continue;
    if (HOOK_INJECT_PREFIXES.some((p) => text.startsWith(p))) continue;
    // Each user message = distinct turn; COMPL counter dedups per turnIndex
    // so identical-text repeats each get fresh budget.
    turnIndex++;
    last = text;
    lastTurnIndex = turnIndex;
    lastTsMs = entryTimestampMs(entry) || lastTsMs;
  }
  return { text: last, turnIndex: lastTurnIndex, tsMs: lastTsMs };
}

function _entryText(entry) {
  const content = (entry && entry.message && entry.message.content) || (entry && entry.content);
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((b) => {
      if (!b) return '';
      if (typeof b === 'string') return b;
      if (b.type === 'text') return b.text || '';
      if (b.text) return b.text;
      if (b.content && typeof b.content === 'string') return b.content;
      return '';
    }).filter(Boolean).join('\n');
  }
  return '';
}


function _assistantToolUses(entry) {
  const content = (entry && entry.message && entry.message.content) || (entry && entry.content);
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && typeof b === 'object' && b.type === 'tool_use');
}

module.exports = {
  lastAssistantText,
  assistantToolUsesSinceLastUserPrompt,
  lastRealUserPrompt,
  _entryText,
  _assistantToolUses,
};
