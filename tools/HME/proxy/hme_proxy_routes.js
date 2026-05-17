'use strict';

function json(clientRes, status, body) {
  clientRes.writeHead(status, { 'Content-Type': 'application/json' });
  clientRes.end(JSON.stringify(body));
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
}) {
  const uselessPaths = new Set(['/', '/favicon.ico', '/robots.txt']);

  return function dispatchProxyRoute(clientReq, clientRes) {
    const url = clientReq.url || '';

    if (url === '/hme/stop-gate/health') {
      json(clientRes, 200, { status: 'ok', component: 'hme-stop-gate', ...stopGateHealth() });
      return true;
    }
    if (url === '/health') {
      const statusFn = supervisorStatus || require('./supervisor/index').status;
      json(clientRes, 200, {
        status: 'ok',
        port: PORT,
        version: PROXY_VERSION,
        git_sha: PROXY_GIT_SHA,
        started_at: PROXY_STARTED_AT,
        routes: routeMetrics,
        supervisor: statusFn(),
      });
      return true;
    }
    if (url === '/version') {
      json(clientRes, 200, { version: PROXY_VERSION, component: 'hme-proxy' });
      return true;
    }
    if (url.startsWith('/hme/spawn')) {
      require('./routes_admin').handleSpawnRoute(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/lifecycle')) {
      const handler = handleLifecycleRoute || require('./lifecycle_bridge').handleLifecycleRoute;
      handler(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/pre-write-check')) {
      require('./pre_write_route').handlePreWriteCheckRoute(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/hme/session/')) {
      require('./session_state_route').handleSessionStateRoute(clientReq, clientRes);
      return true;
    }
    if (url.startsWith('/mcp')) {
      require('./mcp_server/index').handleMcpRequest(clientReq, clientRes);
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
