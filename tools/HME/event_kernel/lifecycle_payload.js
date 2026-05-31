'use strict';

const fs = require('fs');
const path = require('path');
const { requireEnv } = require('../proxy/shared/load_env');
const { append } = require('./host_adapter_common');

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

function failfast(message) {
  const err = new Error(message);
  err.code = 'HME_TRANSCRIPT_FAILFAST';
  throw err;
}

function newestJsonl(dir) {
  const rows = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => path.join(dir, f))
    .map((f) => {
      const stat = fs.statSync(f);
      return { f, c: stat.ctimeMs, m: stat.mtimeMs };
    })
    .sort((a, b) => (b.m - a.m) || (b.c - a.c) || b.f.localeCompare(a.f));
  return rows[0] ? rows[0].f : '';
}

function transcriptForSession(dir, sessionId) {
  if (!sessionId) return '';
  const match = fs.readdirSync(dir).find((f) => f === `${sessionId}.jsonl`);
  return match ? path.join(dir, match) : '';
}

function claudeProjectsDir(root) {
  const projectDir = requireEnv('CLAUDE_PROJECT_DIR');
  return path.join(path.dirname(projectDir), '.claude', 'projects', '-home-jah-Polychron');
}

function writeTranscriptMarker(root, transcript) {
  writeJsonAtomic(path.join(root, 'tmp', 'hme-transcript-path.txt'), `${transcript}\n`);
}

function recordTranscriptFailfast(root, host, err) {
  const msg = `TRANSCRIPT FAILFAST: ${host} Stop transcript resolution failed: ${err.message}`;
  try {
    append(path.join(root, 'log', 'hme-errors.log'), `[${new Date().toISOString()}] [transcript-failfast] ${msg}`);
  } catch (_e) {
    // Last-ditch stderr is not a replacement for fail-fast; the thrown error still block
    try { process.stderr.write(`[transcript-failfast] ${msg}\n`); } catch (_) {}
  }
  return msg;
}

function attachTranscriptFailure(payload, root, host, err) {
  const msg = recordTranscriptFailfast(root, host, err);
  payload._hme_transcript_error = msg;
  return payload;
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
  if (payload && payload.transcript_path) {
    if (!fs.existsSync(payload.transcript_path)) failfast(`provided transcript_path does not exist: ${payload.transcript_path}`);
    writeTranscriptMarker(root, payload.transcript_path);
    return payload;
  }
  const ccDir = claudeProjectsDir(root);
  if (!fs.existsSync(ccDir)) failfast(`Claude transcript project directory missing: ${ccDir}`);
  const sessionId = payload && payload.session_id;
  const transcript = transcriptForSession(ccDir, sessionId) || newestJsonl(ccDir);
  if (!transcript) failfast(`no Claude transcripts under ${ccDir}`);
  if (!fs.existsSync(transcript)) failfast(`resolved transcript missing: ${transcript}`);
  payload.transcript_path = transcript;
  writeTranscriptMarker(root, transcript);
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
  try {
    if (host === 'claude') addClaudeTranscript(payload, root, event);
    else if (host === 'codex') addCodexTranscript(payload, root, event);
    else if (host === 'opencode') addOpencodeTranscript(payload, root, event);
  } catch (err) {
    if (event !== 'Stop' || err.code !== 'HME_TRANSCRIPT_FAILFAST') throw err;
    attachTranscriptFailure(payload, root, host, err);
  }
  return JSON.stringify(payload);
}

module.exports = { parseJson, normalizeLifecyclePayload, buildHostPayload, addClaudeTranscript, addCodexTranscript, addOpencodeTranscript, newestJsonl, writeJsonAtomic };
