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
      .map((f) => {
        const stat = fs.statSync(f);
        return { f, c: stat.ctimeMs, m: stat.mtimeMs };
      })
      .sort((a, b) => (b.m - a.m) || (b.c - a.c) || b.f.localeCompare(a.f));
    return rows[0] ? rows[0].f : '';
  } catch (err) {
    // silent-ok: unreadable transcript directory falls back to no transcript.
    return '';
  }
}

function transcriptForSession(dir, sessionId) {
  if (!sessionId) return '';
  try {
    const match = fs.readdirSync(dir).find((f) => f === `${sessionId}.jsonl`);
    return match ? path.join(dir, match) : '';
  } catch (_err) {
    // silent-ok: unreadable transcript directory falls back to no session match.
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
  if (process.env.HME_SUBAGENT === '1') payload._hme_subagent = true;
  return payload;
}

function addClaudeTranscript(payload, root, event) {
  if (event !== 'Stop') return payload;
  if (payload && payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${payload.transcript_path}\n`); }
    catch (err) { /* best-effort marker only */ }
    return payload;
  }
  const ccDir = path.join(path.dirname(root), '.claude', 'projects', '-home-jah-Polychron');
  const transcript = transcriptForSession(ccDir, payload && payload.session_id)
    || newestJsonl(ccDir)
    || path.join(root, 'log', 'session-transcript.jsonl');
  if (!fs.existsSync(transcript)) return payload;
  payload.transcript_path = transcript;
  try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${transcript}\n`); }
  catch (err) { /* best-effort marker only */ }
  return payload;
}

function _codexSessionsRoot() {
  return process.env.CODEX_HOME
    ? path.join(process.env.CODEX_HOME, 'sessions')
    : path.join(process.env.HOME || '', '.codex', 'sessions');
}

function _findCodexRollout(sessionsRoot, sessionId) {
  if (!sessionId) return '';
  const tail = `-${sessionId}.jsonl`;
  const dayDirs = [];
  try {
    for (const y of fs.readdirSync(sessionsRoot)) {
      const yPath = path.join(sessionsRoot, y);
      try {
        for (const m of fs.readdirSync(yPath)) {
          const mPath = path.join(yPath, m);
          try {
            for (const d of fs.readdirSync(mPath)) {
              dayDirs.push(path.join(mPath, d));
            }
          } catch (_) { /* missing/unreadable day dir */ }
        }
      } catch (_) { /* missing/unreadable month dir */ }
    }
  } catch (_) { return ''; }
  dayDirs.sort((a, b) => b.localeCompare(a));
  for (const dir of dayDirs.slice(0, 7)) {
    try {
      const match = fs.readdirSync(dir).find((f) => f.endsWith(tail));
      if (match) return path.join(dir, match);
    } catch (_) { /* dir may have been removed */ }
  }
  return '';
}

function _translateCodexRollout(root, sessionId, rolloutPath) {
  const dumper = path.join(root, 'tools', 'HME', 'scripts', 'codex_dump_transcript.py');
  if (!fs.existsSync(dumper)) return '';
  const outPath = path.join(root, 'tools', 'HME', 'runtime', 'codex-transcripts', `${sessionId}.jsonl`);
  const { spawnSync } = require('child_process');
  const proc = spawnSync('python3', [dumper, rolloutPath, outPath], { timeout: 10000, encoding: 'utf8' });
  if (proc.status !== 0) return '';
  const resolved = (proc.stdout || '').trim();
  return (resolved && fs.existsSync(resolved)) ? resolved : '';
}

function addCodexTranscript(payload, root, event) {
  if (event !== 'Stop') return payload;
  if (payload && payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${payload.transcript_path}\n`); }
    catch (err) { /* best-effort marker only */ }
    return payload;
  }
  const sessionId = payload && payload.session_id;
  const sessionsRoot = _codexSessionsRoot();
  const rollout = _findCodexRollout(sessionsRoot, sessionId);
  if (!rollout || !fs.existsSync(rollout)) return payload;
  const translated = _translateCodexRollout(root, sessionId, rollout);
  const transcript = translated || rollout;
  payload.transcript_path = transcript;
  try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${transcript}\n`); }
  catch (err) { /* best-effort marker only */ }
  return payload;
}

function addOpencodeTranscript(payload, root, event) {
  if (event !== 'Stop') return payload;
  if (payload && payload.transcript_path && fs.existsSync(payload.transcript_path)) {
    try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${payload.transcript_path}\n`); }
    catch (err) { /* best-effort marker only */ }
    return payload;
  }
  const sessionId = payload && payload.session_id;
  if (!sessionId) return payload;
  const outputPath = path.join(root, 'tools', 'HME', 'runtime', 'opencode-transcripts', `${sessionId}.jsonl`);
  const dumper = path.join(root, 'tools', 'HME', 'scripts', 'opencode_dump_transcript.py');
  if (!fs.existsSync(dumper)) return payload;
  const { spawnSync } = require('child_process');
  const proc = spawnSync('python3', [dumper, sessionId, outputPath], { timeout: 10000, encoding: 'utf8' });
  if (proc.status !== 0) return payload;
  const resolved = (proc.stdout || '').trim();
  if (!resolved || !fs.existsSync(resolved)) return payload;
  payload.transcript_path = resolved;
  try { writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${resolved}\n`); }
  catch (err) { /* best-effort marker only */ }
  return payload;
}

function buildHostPayload({ host, event, root, rawBody, cwd, teamRole }) {
  const payload = normalizeLifecyclePayload({ host, event, root, rawBody, cwd, teamRole });
  if (host === 'claude') addClaudeTranscript(payload, root, event);
  else if (host === 'codex') addCodexTranscript(payload, root, event);
  else if (host === 'opencode') addOpencodeTranscript(payload, root, event);
  return JSON.stringify(payload);
}

module.exports = { parseJson, normalizeLifecyclePayload, buildHostPayload, addClaudeTranscript, addCodexTranscript, addOpencodeTranscript, newestJsonl, writeJsonAtomic };
