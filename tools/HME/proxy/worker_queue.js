'use strict';
/**
 * Filesystem-IPC client for the HME worker.
 *
 * Architectural intent (lesson #1 — make the proxy/worker accelerators,
 * not single points of failure): callers can address the worker via
 * filesystem queue files instead of synchronous HTTP. The HTTP path
 * remains for backward compatibility; the queue path lets callers
 * proceed even when the worker is hung (CPU saturated, GIL hang) or
 * temporarily down.
 *
 * Contract:
 *   - Caller writes a job file to tmp/hme-worker-queue/<endpoint>/<jobId>.json
 *     atomically (tmp + rename). Body shape: {jobId, endpoint, body, ts}.
 *   - Worker tail-follows tmp/hme-worker-queue/, processes each job,
 *     writes the response to tmp/hme-worker-results/<jobId>.json
 *     atomically. Worker also unlinks the consumed job file.
 *   - Caller polls tmp/hme-worker-results/ for the matching jobId, with
 *     a configurable timeout. Successful reads delete the result file
 *     to keep the directory bounded.
 *
 * Use cases beyond proxy middleware:
 *   - i/* CLIs that want enrichment without booting the proxy.
 *   - Test harnesses that want deterministic worker invocations.
 *   - Future remote-trigger scenarios where the worker may not be
 *     reachable over HTTP but is process-local.
 *
 * Failure semantics:
 *   - dropJob always succeeds if the filesystem is writable. Returns jobId.
 *   - waitForResult returns null on timeout (caller decides degradation).
 *   - call() composes drop + wait with a single timeout.
 *
 * No retries here — that's a caller policy. A failed call returns null;
 * caller can retry, fall back, or surface to the user.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PROJECT_ROOT } = require('./shared');

const QUEUE_DIR   = path.join(PROJECT_ROOT, 'tmp', 'hme-worker-queue');
const RESULTS_DIR = path.join(PROJECT_ROOT, 'tmp', 'hme-worker-results');

function _ensure(dir) {
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_e) { /* best-effort */ }
}

/**
 * Drop a job file atomically. Returns the jobId for waitForResult.
 * Endpoints currently honored by the worker watcher: 'enrich',
 * 'enrich_prompt', 'audit'. Unknown endpoints get an `error` result.
 */
function dropJob(endpoint, body) {
  const endpointDir = path.join(QUEUE_DIR, endpoint);
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
 * Polling interval defaults to 50ms — fast enough for sub-second jobs,
 * cheap enough to not pin a CPU. For long-running jobs callers can
 * raise pollMs.
 */
async function waitForResult(jobId, timeoutMs = 10_000, pollMs = 50) {
  const resultFile = path.join(RESULTS_DIR, `${jobId}.json`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(resultFile)) {
      try {
        const text = fs.readFileSync(resultFile, 'utf8');
        const data = JSON.parse(text);
        try { fs.unlinkSync(resultFile); } catch (_e) { /* best-effort cleanup */ }
        return data;
      } catch (_e) {
        // Partial write between exists() and read; loop and retry.
      }
    }
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
  return await waitForResult(jobId, timeoutMs, pollMs);
}

module.exports = { dropJob, waitForResult, call, QUEUE_DIR, RESULTS_DIR };
