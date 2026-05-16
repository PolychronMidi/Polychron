'use strict';
const fs = require('fs');

const HOOK_PREFIXES = [
  'Stop hook feedback:', 'AUTO-COMPLETENESS INJECT', '[ALERT] LIFESAVER',
  'NEXUS --', '[[HME_AGENT_TASK', 'PreToolUse:', 'PostToolUse:',
];

function _content(ev) {
  const msg = ev && ev.message;
  const c = msg && Object.prototype.hasOwnProperty.call(msg, 'content') ? msg.content : ev && ev.content;
  return Array.isArray(c) ? c : (typeof c === 'string' ? [c] : []);
}

function _text(ev) {
  const out = [];
  for (const b of _content(ev)) {
    if (typeof b === 'string') out.push(b);
    else if (b && b.type === 'text' && typeof b.text === 'string') out.push(b.text);
  }
  return out.join('\n').trim();
}

function _loadEvents(transcriptPath) {
  try {
    return fs.readFileSync(transcriptPath, 'utf8').split('\n')
      .filter(Boolean).map((line) => { try { return JSON.parse(line); } catch (_) { return null; } })
      .filter(Boolean);
  } catch (_) { return []; }
}

function _realUsers(events) {
  const users = [];
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if ((ev.type || ev.role) !== 'user') continue;
    const text = _text(ev);
    if (!text || HOOK_PREFIXES.some((p) => text.startsWith(p))) continue;
    users.push({ index: i, text });
  }
  return users;
}

function _toolBlobsAfter(events, idx) {
  const blobs = [];
  for (const ev of events.slice(idx + 1)) {
    for (const b of _content(ev)) {
      if (b && b.type === 'tool_use') blobs.push(`${b.name || ''} ${JSON.stringify(b.input || {})}`.toLowerCase());
    }
  }
  return blobs;
}

function _corrective(text) {
  return /\b(what\s+.*think\s+i\s+meant|i\s+meant|i\s+just\s+said|just\s+said|come\s+on|no[,\s]+i'?m\s+saying|had\s+to\s+tell\s+you)\b/i.test(text || '');
}

function _parentWork(text) {
  return /\b(audit|analy[sz]e|inspect|review|sweep)\b[\s\S]{0,140}\b(scripts\/|tools\/|src\/|directory|folder|repo|unused|obsolete|deletion\s+targets|least\s+recently)\b/i.test(text || '')
    || /\bdirectory-level\s+audit\b/i.test(text || '');
}

function _targetTerms(text) {
  const low = String(text || '').toLowerCase();
  const targets = [];
  for (const m of low.matchAll(/\b(?:scripts|tools\/hme|tools|src|doc|config|runtime)\/?\b/g)) targets.push(m[0].replace(/\/$/, ''));
  if (/scripts\//.test(low)) targets.push('scripts');
  return [...new Set(targets)];
}

function _hasContinuationEvidence(toolBlobs, parentText) {
  const targets = _targetTerms(parentText);
  const auditTerms = ['unused', 'obsolete', 'least', 'recent', 'recently', 'deletion', 'target', 'runnable', 'observed_run', 'never_observed', 'refs', 'ranking', 'cold'];
  for (const blob of toolBlobs) {
    const targetHit = targets.length === 0 || targets.some((t) => blob.includes(t));
    const auditHits = auditTerms.filter((t) => blob.includes(t)).length;
    if (targetHit && auditHits >= 2) return true;
  }
  return false;
}

function parentTaskDebt(transcriptPath) {
  const events = _loadEvents(transcriptPath);
  const users = _realUsers(events);
  if (users.length < 2) return null;
  const last = users[users.length - 1];
  if (!_corrective(last.text)) return null;
  const parent = [...users.slice(0, -1)].reverse().find((u) => _parentWork(u.text));
  if (!parent) return null;
  if (_hasContinuationEvidence(_toolBlobsAfter(events, last.index), parent.text)) return null;
  return 'CORRECTION-PIVOT VIOLATION: The last user correction clarified one subitem, but an earlier broad parent task is still active. Resume that parent task before stopping. Parent task: '
    + parent.text.replace(/\s+/g, ' ').slice(0, 260);
}

module.exports = { parentTaskDebt, _private: { _corrective, _parentWork, _hasContinuationEvidence } };
