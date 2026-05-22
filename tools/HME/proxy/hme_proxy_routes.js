'use strict';

const { execFileSync } = require('child_process');
const { PROJECT_ROOT } = require('./shared');

function json(clientRes, status, body) {
  clientRes.writeHead(status, { 'Content-Type': 'application/json' });
  clientRes.end(JSON.stringify(body));
}


function currentRepoGitSha() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    }).trim();
  } catch (_e) {
    return null;
  }
}

function requiredSupervisorFailures(supervisor) {
  return Object.entries(supervisor || {})
    .filter(([, child]) => child && child.required !== false && (!!child.gaveUp || !child.healthy))
    .map(([name]) => name);
}

function healthVerdict(supervisor, runningSha) {
  const supervisor_failures = requiredSupervisorFailures(supervisor);
  const current_git_sha = currentRepoGitSha();
  const runtime_stale = Boolean(current_git_sha && runningSha && current_git_sha !== runningSha);
  const ok = supervisor_failures.length === 0 && !runtime_stale;
  return {
    ok,
    listener_ready: true,
    status: ok ? 'ok' : 'degraded',
    httpStatus: ok ? 200 : 503,
    supervisor_failures,
    current_git_sha,
    runtime_stale,
  };
}

function createProxyRouteDispatcher({
  PORT,
  PROXY_VERSION,
  PROXY_GIT_SHA,
  PROXY_STARTED_AT,
  routeMetrics,
  stopGateHealth,
  supervisorStatus,
  handleSpawnRoute,
  handleLifecycleRoute,
  handlePreWriteCheckRoute,
  handleSessionStateRoute,
  handleMcpRequest,
  loadedMiddleware = [],
}) {
  const uselessPaths = new Set(['/', '/favicon.ico', '/robots.txt']);

  return function dispatchProxyRoute(clientReq, clientRes) {
    const url = clientReq.url || '';

    if (url === '/hme/stop-gate/health') {
      json(clientRes, 200, { status: 'ok', component: 'hme-stop-gate', ...stopGateHealth() });
      return true;
    }
    if (url === '/health' || url === '/ready') {
      const statusFn = supervisorStatus || require('./supervisor/index').status;
      const supervisor = statusFn();
      const verdict = healthVerdict(supervisor, PROXY_GIT_SHA);
      const readyOnly = url === '/ready';
      json(clientRes, readyOnly ? 200 : verdict.httpStatus, {
        status: readyOnly ? 'ready' : verdict.status,
        ok: readyOnly ? true : verdict.ok,
        listener_ready: true,
        port: PORT,
        version: PROXY_VERSION,
        git_sha: PROXY_GIT_SHA,
        current_git_sha: verdict.current_git_sha,
        runtime_stale: verdict.runtime_stale,
        supervisor_failures: verdict.supervisor_failures,
        started_at: PROXY_STARTED_AT,
        routes: routeMetrics,
        middleware: loadedMiddleware,
        supervisor,
      });
      return true;
    }
    if (url === '/version') {
      json(clientRes, 200, { version: PROXY_VERSION, component: 'hme-proxy' });
      return true;
    }
    if (url.startsWith('/hme/spawn')) {
      const handler = handleSpawnRoute || require('./routes_admin').handleSpawnRoute;
      handler(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/lifecycle')) {
      const handler = handleLifecycleRoute || require('./lifecycle_bridge').handleLifecycleRoute;
      handler(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/pre-write-check')) {
      const handler = handlePreWriteCheckRoute || require('./pre_write_route').handlePreWriteCheckRoute;
      handler(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/session/')) {
      const handler = handleSessionStateRoute || require('./session_state_route').handleSessionStateRoute;
      handler(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/mcp')) {
      const handler = handleMcpRequest || require('./mcp_server/index').handleMcpRequest;
      handler(clientReq, clientRes);
      return true;
    }

    // Short-circuit browser/monitor probes before they burn upstream rate budget.
    if (uselessPaths.has(url)) {
      json(clientRes, 404, { error: 'not_found', note: 'hme-proxy: useless-path probe short-circuited (not forwarded to Anthropic)' });
      return true;
    }
    return false;
  };
}

module.exports = { createProxyRouteDispatcher };
