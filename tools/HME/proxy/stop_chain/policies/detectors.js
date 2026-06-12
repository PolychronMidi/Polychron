'use strict';
// Direct detector runner. Must write verdicts before anti_patterns/work_checks.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { PROJECT_ROOT } = require('../../shared');

const RUN_ALL = path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'detectors', 'run_all.py');
const VERDICTS_FILE = path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'stop-detector-verdicts.env');
const DETECTOR_TIMEOUT_MS = 15_000; // run_all.py p95 ~471ms; 15s is 30x headroom

function runAllDetectors(transcriptPath) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    const env = { ...process.env, PROJECT_ROOT };
    // Ensure env vars that detectors read at import time (e.g. boyscout_clean
    // reads COMMENT_BLOAT_FAIL at module level) are present. These are set in
    const child = spawn('python3', [RUN_ALL, transcriptPath], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try { child.kill('SIGTERM'); } catch (_e) { /* best-effort */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) { /* child already gone */ } }, 500).unref();
      resolve({ ok: false, error: `timeout after ${DETECTOR_TIMEOUT_MS}ms`, stdout, stderr });
    }, DETECTOR_TIMEOUT_MS);

    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ ok: false, error: `spawn error: ${err.message}`, stdout, stderr });
    });
    child.on('close', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: `exit ${code} (signal=${signal})`, stdout, stderr });
        return;
      }
      resolve({ ok: true, stdout, stderr });
    });
  });
}

function parseVerdicts(stdout) {
  const verdicts = {};
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    verdicts[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return verdicts;
}

function writeVerdictsFile(verdicts) {
  try {
    fs.mkdirSync(path.dirname(VERDICTS_FILE), { recursive: true });
    const lines = Object.entries(verdicts).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
    fs.writeFileSync(VERDICTS_FILE, lines);
  } catch (_e) { /* verdicts-file write failure is never fatal */ }
}

function transcriptPayload(stdinJson) {
  try {
    return JSON.parse(stdinJson || '{}') || {};
  } catch (_e) { return {}; }
}

module.exports = {
  name: 'detectors',
  async run(ctx) {
    const payload = transcriptPayload(ctx.stdinJson);
    if (payload._hme_transcript_error) return ctx.deny(payload._hme_transcript_error);
    const transcript = payload.transcript_path || '';
    if (!transcript) return ctx.deny(
      'STOP-CHAIN INTEGRITY FAILURE: missing Stop transcript_path; detectors cannot run. Fix transcript resolution before stopping.'
    );
    if (!fs.existsSync(transcript)) return ctx.deny(
      `STOP-CHAIN INTEGRITY FAILURE: Stop transcript_path does not exist: ${transcript}`
    );

    const result = await runAllDetectors(transcript);

    if (!result.ok) {
      const detail = (result.error || 'unknown error').slice(0, 800);
      return ctx.deny(
        `STOP-CHAIN INTEGRITY FAILURE: detectors policy failed closed (${detail}). ` +
        'Fix the detector runner before stopping.'
      );
    }

    const verdicts = parseVerdicts(result.stdout);
    writeVerdictsFile(verdicts);
    return ctx.allow();
  },
};
