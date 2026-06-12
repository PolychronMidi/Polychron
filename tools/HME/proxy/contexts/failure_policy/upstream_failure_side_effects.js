'use strict';

const { requireEnv: _hmeRequireEnv } = require('../../shared/load_env.js');
const fs = require('fs');
const path = require('path');
const { emit, PROJECT_ROOT } = require('../../shared');
const { recordUpstreamFailure } = require('../upstream_dispatch');

function recordEscapeHatch({ isInteractivePath, coolingDown, errMsg, isOmniRouteSwap }) {
  if (isInteractivePath && !coolingDown && process.env.OVERDRIVE_MODE !== '1') {
    recordUpstreamFailure(errMsg);
  } else if (isInteractivePath) {
    console.error(`escape hatch SUPPRESSED (OVERDRIVE_MODE=${_hmeRequireEnv('OVERDRIVE_MODE')}, _isOmniRouteSwap=${isOmniRouteSwap}) -- passthrough blocked`);
  } else if (!isInteractivePath) {
    console.error('sub-pipeline failure -- NOT tripping escape hatch (interactive path unaffected)');
  }
}

function snapshotFailure({
  status,
  headers,
  fullBody,
  outBody,
  clientReq,
  upstreamHeaders,
  errInfo,
  errMsg,
  stamp,
  snapshotRel,
  pathLabel,
  coolingDown,
  projectRoot = PROJECT_ROOT,
}) {
  try {
    const outFile = path.join(projectRoot, snapshotRel);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, outBody);
    fs.writeFileSync(outFile.replace('.json', '.response'), fullBody);
    fs.writeFileSync(outFile.replace('.json', '.headers.json'), JSON.stringify(headers, null, 2));
    try {
      fs.writeFileSync(outFile.replace('.json', '.request-headers.json'), JSON.stringify({
        method: clientReq.method,
        url: clientReq.url,
        incoming_headers: clientReq.headers,
        outgoing_headers: upstreamHeaders,
      }, null, 2));
    } catch (_e) { /* best-effort */ }
    console.error(`payload snapshotted to ${outFile}`);
    const suppressLifesaver = coolingDown || pathLabel === 'sub-pipeline';
    if (!suppressLifesaver) {
      const errLog = path.join(projectRoot, 'log', 'hme-errors.log');
      fs.appendFileSync(errLog,
        `[${stamp}] UPSTREAM_${status}_${pathLabel.toUpperCase()}: ${errMsg} (request_id=${errInfo.requestId || '?'}, snapshot=${snapshotRel})\n`);
    }
  } catch (err) {
    console.error(`snapshot/lifesaver write failed: ${err.message}`);
  }
}

function recordFailureSideEffects({
  status,
  headers,
  fullBody,
  outBody,
  clientReq,
  upstreamHeaders,
  errInfo,
  errMsg,
  stamp,
  snapshotRel,
  pathLabel,
  coolingDown,
  isInteractivePath,
  isOmniRouteSwap,
  sessionForTelemetry,
  projectRoot = PROJECT_ROOT,
}) {
  recordEscapeHatch({ isInteractivePath, coolingDown, errMsg, isOmniRouteSwap });
  snapshotFailure({
    status,
    headers,
    fullBody,
    outBody,
    clientReq,
    upstreamHeaders,
    errInfo,
    errMsg,
    stamp,
    snapshotRel,
    pathLabel,
    coolingDown,
    projectRoot,
  });
  emit({
    event: 'upstream_error',
    session: sessionForTelemetry,
    status,
    type: errInfo.type,
    message: errInfo.message,
    path_label: pathLabel,
  });
}

module.exports = {
  recordEscapeHatch,
  recordFailureSideEffects,
  snapshotFailure,
};
