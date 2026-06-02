'use strict';

const fs = require('fs');
const path = require('path');

function _readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_e) { return null; }
}

function _shortSha(root) {
  try { return require('child_process').execFileSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 1000 }).trim(); } catch (_e) { return ''; }
}

function _observationOrSelf(line, _root) {
  const body = String(line || '').replace(/^\[[0-9TZ:.-]+\]\s*/, '');
  if (/\b(WARN|WARNING|INFO|DEBUG|NOTICE)\b/.test(body)) return { resolved: true, kind: 'observation', resolver: 'severity classifier', proof: { line: body.slice(0, 160) }, reason: 'observation severity is not agent debt' };
  if (/^\[(universal_pulse|hme-proxy|shuffler|proxy-liveness|proxy-failure|autocommit)\]/.test(body)) return { resolved: true, kind: 'self_origin', resolver: 'self-origin classifier', proof: { line: body.slice(0, 160) }, reason: 'self-origin historical line is not open agent debt' };
  return null;
}

function _autocommitResolved(line, root) {
  if (!/\[autocommit\].*pre-commit validation blocked/i.test(line)) return null;
  const out = (() => { try { return require('child_process').execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8', timeout: 1000 }).trim(); } catch (_e) { return ''; } })();
  return { resolved: out === '', kind: 'autocommit', resolver: 'git status --short empty', proof: { status: out }, reason: out === '' ? 'working tree is clean' : 'working tree still dirty' };
}

function _upstreamContextWindow(line, root) {
  if (!/UPSTREAM_200_INTERACTIVE:.*context window/i.test(line)) return null;
  const m = /snapshot=([^\s)]+)/.exec(line);
  if (!m) return { resolved: false, kind: 'upstream_context_window', reason: 'missing snapshot pointer' };
  const snapshotRel = m[1];
  const snapshot = path.join(root, snapshotRel);
  const payload = _readJson(snapshot);
  if (!payload) return { resolved: false, kind: 'upstream_context_window', reason: 'snapshot not readable', snapshot: snapshotRel };
  const { evaluateOutbound } = require('./outbound_context_gate');
  const model = String(payload.model || '').includes('/') ? String(payload.model).split('/').slice(1).join('/') : String(payload.model || '');
  const verdict = evaluateOutbound({ payload: JSON.parse(JSON.stringify(payload)), modelId: model, swapChain: [] });
  return {
    resolved: verdict && verdict.ok === false && verdict.action === 'over_window',
    kind: 'upstream_context_window',
    resolver: 'outbound_context_gate.evaluateOutbound',
    snapshot: snapshotRel,
    proof: verdict,
    reason: verdict && verdict.ok === false ? 'captured payload is now refused locally' : 'captured payload still not refused locally',
  };
}

function _staleRuntime(line, root) {
  if (!/\[stale_runtime\]|slot [ab] stranded on stale code|proxy is NOT serving current code/i.test(line)) return null;
  const head = _shortSha(root);
  const runtime = _readJson(path.join(root, 'tools/HME/runtime/proxy-runtime.json'));
  const live = runtime && String(runtime.git_sha || '');
  return {
    resolved: Boolean(head && live && head === live),
    kind: 'runtime_convergence',
    resolver: 'proxy-runtime.git_sha == HEAD',
    proof: { head, live },
    reason: head && live && head === live ? 'runtime fingerprint matches current HEAD' : 'runtime fingerprint not proven current',
  };
}

const RESOLVERS = [_upstreamContextWindow, _staleRuntime];

function resolveLine(root, line) {
  for (const r of RESOLVERS) {
    const out = r(String(line || ''), root);
    if (out) return out;
  }
  return { resolved: false, kind: 'unclassified', resolver: '', proof: {}, reason: 'no resolver registered' };
}

function unresolvedLines(root, lines) {
  return (lines || []).filter((line) => !resolveLine(root, line).resolved);
}

module.exports = { RESOLVERS, resolveLine, unresolvedLines };
