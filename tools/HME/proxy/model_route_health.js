'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

function routeHealthPath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot, 'tools', 'HME', 'runtime', 'model-route-health.json');
}

function loadModelRouteHealth(projectRoot = PROJECT_ROOT) {
  const file = routeHealthPath(projectRoot);
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_err) {
    return {};
  }
}

function routeQuarantineForced(env = process.env) {
  return env.HME_FORCE_QUARANTINED_ROUTES === '1' || env.HME_MODEL_ROUTE_QUARANTINE === '0';
}

function _timeMs(value) {
  if (typeof value !== 'string' || !value.trim()) return 0;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function quarantineReason(entry, now = Date.now()) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return '';
  const status = String(entry.status || '').trim().toLowerCase();
  if (!status || ['ok', 'active', 'pass', 'passed'].includes(status)) return '';
  const untilMs = _timeMs(entry.until);
  if (untilMs && now >= untilMs) return '';
  if (!['cooldown', 'blocked', 'unavailable', 'failed', 'disabled'].includes(status)) return '';
  return String(entry.reason || status).trim() || status;
}

function routeSkipReason(routeKey, routeHealth = {}, env = process.env, now = Date.now()) {
  if (!routeKey || routeQuarantineForced(env)) return '';
  return quarantineReason(routeHealth[routeKey], now);
}

module.exports = {
  routeHealthPath,
  loadModelRouteHealth,
  routeQuarantineForced,
  quarantineReason,
  routeSkipReason,
};
