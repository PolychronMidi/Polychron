'use strict';

const fs = require('fs');
const path = require('path');

function parseJson(raw) {
  try { return JSON.parse(raw || '{}'); }
  catch (err) { return { _hme_parse_error: err.message }; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, value);
  fs.renameSync(tmp, file);
}

function newestJsonl(dir) {
  try {
    const rows = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, m: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    return rows[0] ? rows[0].f : '';
  } catch (err) {
    return '';
  }
}

function normalizeLifecyclePayload({ host, event, root, rawBody, cwd, teamRole }) {
  const payload = parseJson(rawBody);
  payload._hme_host = host;
  payload._hme_event = event;
  if (root) payload._hme_project_root = root;
  if (!payload.cwd) payload.cwd = cwd || process.cwd();
  if (!payload.session_id && payload.thread_id) payload.session_id = payload.thread_id;
  if (teamRole && !payload._hme_team_role) payload._hme_team_role = teamRole;
  return payload;
}

function addClaudeTranscript(payload, root, event) {
  if (event !== 'Stop') return payload;
  const ccDir = path.join(path.dirname(root), '.claude', 'projects', '-home-jah-Polychron');
  const transcript = newestJsonl(ccDir) || path.join(root, 'log', 'session-transcript.jsonl');
  if (!fs.existsSync(transcript)) return payload;
  payload.transcript_path = transcript;
  try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${transcript}\n`); }
  catch (err) { /* best-effort marker only */ }
  return payload;
}

function buildHostPayload({ host, event, root, rawBody, cwd, teamRole }) {
  const payload = normalizeLifecyclePayload({ host, event, root, rawBody, cwd, teamRole });
  if (host === 'claude') addClaudeTranscript(payload, root, event);
  return JSON.stringify(payload);
}

module.exports = { parseJson, normalizeLifecyclePayload, buildHostPayload, addClaudeTranscript, newestJsonl, writeJsonAtomic };
