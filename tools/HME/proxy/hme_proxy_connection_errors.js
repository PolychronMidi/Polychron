'use strict';

const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('./shared');

const RETRYABLE_CONN_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE']);

function pathLabel(isInteractivePath) {
  return isInteractivePath ? 'interactive' : 'sub-pipeline';
}

function safeRelease(releaseOpusSlot) {
  try { releaseOpusSlot(); } catch (_e) { /* ignore */ }
}

function writeMidResponseLog({ errCode, label, errMsg, projectRoot = PROJECT_ROOT }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const errLog = path.join(projectRoot, 'log', 'hme-errors.log');
  fs.mkdirSync(path.dirname(errLog), { recursive: true });
  fs.appendFileSync(errLog, `[${stamp}] UPSTREAM_${errCode}_${label.toUpperCase()}_MIDRESPONSE: ${errMsg}\n`);
}

function writeConnectionSnapshot({ errCode, label, errMsg, outBody, projectRoot = PROJECT_ROOT }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshotRel = `tmp/claude-${errCode}-${label}-payload-${stamp}.json`;
  const outFile = path.join(projectRoot, snapshotRel);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, outBody);
  if (label === 'interactive') {
    const errLog = path.join(projectRoot, 'log', 'hme-errors.log');
    fs.appendFileSync(errLog, `[${stamp}] UPSTREAM_${errCode}_${label.toUpperCase()}: ${errMsg} (snapshot=${snapshotRel})\n`);
  }
}

function handleMidResponseError({
  err,
  clientRes,
  isInteractivePath,
  releaseOpusSlot,
  recordFailure,
  emitFn = emit,
  log = console.error,
  projectRoot = PROJECT_ROOT,
}) {
  safeRelease(releaseOpusSlot);
  const errCode = err.code || 'mid_response';
  const label = pathLabel(isInteractivePath);
  const errMsg = `upstream ${errCode} mid-response [${label}]: ${err.message}`;
  log(`upstream read error: ${errMsg}`);
  if (isInteractivePath) recordFailure(errMsg);
  try {
    writeMidResponseLog({ errCode, label, errMsg, projectRoot });
  } catch (_e) { /* lifesaver write best-effort; console log already surfaced it */ }
  emitFn({ event: 'upstream_midresponse_error', code: errCode, message: err.message, path_label: label });
  if (!clientRes.headersSent) {
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream_midresponse', code: errCode, message: err.message } }));
  } else {
    clientRes.end();
  }
}

function shouldRetryConnectionError({
  connRetryEnabled = process.env.HME_PROXY_CONNRESET_RETRY === '1',
  isInteractivePath,
  connAttempt,
  clientRes,
  errCode,
  retryCodes = RETRYABLE_CONN_CODES,
}) {
  return connRetryEnabled && isInteractivePath && connAttempt === 1
    && !clientRes.headersSent && retryCodes.has(errCode);
}

function handleConnectionError({
  err,
  clientRes,
  isInteractivePath,
  connAttempt,
  outBody,
  releaseOpusSlot,
  spawnUpstream,
  recordFailure,
  connRetryEnabled = process.env.HME_PROXY_CONNRESET_RETRY === '1',
  retryCodes = RETRYABLE_CONN_CODES,
  emitFn = emit,
  log = console.error,
  projectRoot = PROJECT_ROOT,
}) {
  safeRelease(releaseOpusSlot);
  const errCode = err.code || 'unknown';
  const label = pathLabel(isInteractivePath);
  if (shouldRetryConnectionError({ connRetryEnabled, isInteractivePath, connAttempt, clientRes, errCode, retryCodes })) {
    log(`${errCode} -- single retry (HME_PROXY_CONNRESET_RETRY=1)`);
    spawnUpstream();
    return;
  }
  const errMsg = `upstream ${errCode} [${label}]: ${err.message}`;
  log(`upstream connection error: ${errMsg}`);
  if (isInteractivePath) recordFailure(errMsg);
  else log('sub-pipeline conn-error -- NOT tripping escape hatch');
  try {
    writeConnectionSnapshot({ errCode, label, errMsg, outBody, projectRoot });
  } catch (snapErr) {
    log(`conn-error snapshot/lifesaver write failed: ${snapErr.message}`);
  }
  emitFn({ event: 'upstream_conn_error', code: errCode, message: err.message, path_label: label });
  if (!clientRes.headersSent) {
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ type: 'error', error: { type: 'hme_proxy_upstream', code: errCode, message: err.message } }));
  } else {
    clientRes.end();
  }
}

module.exports = {
  RETRYABLE_CONN_CODES,
  handleMidResponseError,
  shouldRetryConnectionError,
  handleConnectionError,
};
