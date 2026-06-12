'use strict';
// Bridge: route any middleware throw to the LIFESAVER channel.
//

const incidentRegistry = require('../incident_registry');

const ERROR_LOG_REL = incidentRegistry.ERROR_LOG_REL;

// Round-trip detector for our own emitted line.
const _MIDDLEWARE_THROW_RE = /\[middleware-throw\] LIFESAVER -- /;

function _ts() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z');
}

function _errText(err) {
  if (err && typeof err.message === 'string') return err.message;
  return String(err);
}

// Build the single log line (no trailing newline). Collapse whitespace so a
// multi-line error message can't smuggle in a blank line the scanner drops.
function formatMiddlewareThrowLine(modName, err) {
  const name = String(modName || 'unknown');
  const msg = _errText(err).replace(/\s+/g, ' ').slice(0, 600);
  return `[${_ts()}] [middleware-throw] LIFESAVER -- middleware ${name}.onRequest threw and was swallowed: ${msg}`;
}

function recordMiddlewareThrow(root, modName, err) {
  const line = formatMiddlewareThrowLine(modName, err);
  return incidentRegistry.recordIncident(root, {
    id: 'middleware-throw',
    severity: 'lifesaver',
    component: 'proxy-middleware',
    summary: `middleware ${String(modName || 'unknown')}.onRequest threw and was swallowed: ${_errText(err).replace(/\s+/g, ' ').slice(0, 600)}`,
    dedupeKey: `middleware-throw:${String(modName || 'unknown')}`,
    evidence: { middleware: String(modName || 'unknown') },
  }, { line });
}

// Generic proxy-failure -> LIFESAVER sink. Project rule: EVERY swallowed
// failure must surface as a LIFESAVER, not a console.error that dies in
function formatProxyFailureLine(site, err) {
  const tag = String(site || 'proxy').replace(/\s+/g, '-');
  const msg = _errText(err).replace(/\s+/g, ' ').slice(0, 600);
  return `[${_ts()}] [proxy-failure] LIFESAVER -- ${tag} failed and was swallowed: ${msg}`;
}

function recordProxyFailure(root, site, err) {
  const line = formatProxyFailureLine(site, err);
  const tag = String(site || 'proxy').replace(/\s+/g, '-');
  return incidentRegistry.recordIncident(root, {
    id: 'proxy-failure',
    severity: 'lifesaver',
    component: 'proxy',
    summary: `${tag} failed and was swallowed: ${_errText(err).replace(/\s+/g, ' ').slice(0, 600)}`,
    dedupeKey: `proxy-failure:${tag}`,
    evidence: { site: tag },
  }, { line });
}

module.exports = {
  formatMiddlewareThrowLine,
  recordMiddlewareThrow,
  formatProxyFailureLine,
  recordProxyFailure,
  _MIDDLEWARE_THROW_RE,
  ERROR_LOG_REL,
};
