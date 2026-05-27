'use strict';

function createRouteMetrics() {
  const metrics = {
    requests: 0,
    omniroute: 0,
    legacy_swap: 0,
    direct: 0,
    passthrough: 0,
    errors: 0,
    last_route: '',
    last_model: '',
    last_error: '',
    last_request_at: '',
  };
  function recordRoute(route, model) {
    metrics.requests += 1;
    if (Object.prototype.hasOwnProperty.call(metrics, route)) metrics[route] += 1;
    metrics.last_route = route || '';
    metrics.last_model = model || '';
    metrics.last_request_at = new Date().toISOString();
  }
  function recordError(err) {
    metrics.errors += 1;
    metrics.last_error = err && err.message ? err.message : String(err || '');
  }
  return { metrics, recordRoute, recordError };
}

module.exports = { createRouteMetrics };
