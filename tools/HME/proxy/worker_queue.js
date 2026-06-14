'use strict';
// Filesystem IPC client for HME worker jobs: atomic queue files plus result polling.
// HTTP remains for compatibility; queue timeouts return null so callers choose degradati

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./shared');

function _dirs(root = PROJECT_ROOT) {
  return {
    QUEUE_DIR: path.join(root, 'tmp', 'hme-worker-queue'),
    RESULTS_DIR: path.join(root, 'tmp', 'hme-worker-results'),
  };
}

const { QUEUE_DIR, RESULTS_DIR } = _dirs(PROJECT_ROOT);

function _ensure(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) { /* best-effort */ }
}

/**
 * Drop a job file atomically. Returns the jobId for waitForResult.
 * Endpoints currently honored by the worker watcher: 'enrich',
 * 'enrich_prompt', 'audit'. Unknown endpoints get an `error` result.
 */
function dropJob(endpoint, body, queueDir = QUEUE_DIR) {
  const endpointDir = path.join(queueDir, endpoint);
  _ensure(endpointDir);
  const jobId = crypto.randomBytes(8).toString('hex');
  const jobFile = path.join(endpointDir, `${jobId}.json`);
  const tmpFile = jobFile + '.tmp';
  fs.writeFileSync(
    tmpFile,
    JSON.stringify({ jobId, endpoint, body, ts: Date.now() })
  );
  fs.renameSync(tmpFile, jobFile);
  return jobId;
}

/**
 * Poll the results directory for a job's response. Returns the parsed
 * JSON on success, null on timeout. Deletes the result file when read.
 *
 * Polling interval defaults to 50ms -- fast enough for sub-second jobs,
 * cheap enough to not pin a CPU. For long-running jobs callers can
 * raise pollMs.
 */
async function waitForResult(jobId, timeoutMs = 10_000, pollMs = 50, resultsDir = RESULTS_DIR) {
  const resultFile = path.join(resultsDir, `${jobId}.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(resultFile)) {
      try {
        const text = fs.readFileSync(resultFile, 'utf8');
        const data = JSON.parse(text);
        try { fs.unlinkSync(resultFile); } catch (_e) { /* best-effort cleanup */ }
        return data;
      } catch (_e) {
        // silent-ok: partial result-file read races poll loop; it retries.
        // Partial write between exists() and read; loop and retry.
      }
    }
    // eslint-disable-next-line no-await-in-loop -- sequential result-file poll: each sle
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

/**
 * Drop + wait composition. Most callers use this directly.
 */
async function call(endpoint, body, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10_000;
  const pollMs    = opts.pollMs    || 50;
  const jobId = dropJob(endpoint, body);
  return waitForResult(jobId, timeoutMs, pollMs);
}

function createClient(root = PROJECT_ROOT) {
  const dirs = _dirs(root);
  return {
    QUEUE_DIR: dirs.QUEUE_DIR,
    RESULTS_DIR: dirs.RESULTS_DIR,
    dropJob(endpoint, body) { return dropJob(endpoint, body, dirs.QUEUE_DIR); },
    waitForResult(jobId, timeoutMs = 10_000, pollMs = 50) {
      return waitForResult(jobId, timeoutMs, pollMs, dirs.RESULTS_DIR);
    },
    async call(endpoint, body, opts = {}) {
      const timeoutMs = opts.timeoutMs || 10_000;
      const pollMs = opts.pollMs || 50;
      const jobId = dropJob(endpoint, body, dirs.QUEUE_DIR);
      return waitForResult(jobId, timeoutMs, pollMs, dirs.RESULTS_DIR);
    },
  };
}

module.exports = { dropJob, waitForResult, call, createClient, QUEUE_DIR, RESULTS_DIR };
