'use strict';
/**
 * Executable registry for event-kernel routes.
 *
 * dispatcher-routes.json declares non-derivable routing facts; this module turns
 * that declaration into queryable runtime data so dispatcher.js does not grow a
 * second hidden routing table.
 */

const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, 'dispatcher-routes.json');
let _cache = null;

function _load() {
  if (_cache) return _cache;
  const data = JSON.parse(fs.readFileSync(ROUTES_FILE, 'utf8'));
  const routes = Array.isArray(data.routes) ? data.routes : [];
  const byEvent = new Map();
  for (const r of routes) {
    if (!r || typeof r.event !== 'string' || !r.event) {
      throw new Error('dispatcher-routes.json: each route requires non-empty event');
    }
    if (byEvent.has(r.event)) throw new Error(`dispatcher-routes.json: duplicate event ${r.event}`);
    byEvent.set(r.event, r);
  }
  _cache = {
    raw: data,
    routes,
    byEvent,
    observationEvents: new Set(data.observation_events || []),
  };
  return _cache;
}

function resetForTests() {
  _cache = null;
}

function routeFor(eventName) {
  return _load().byEvent.get(eventName) || null;
}

function routes() {
  return _load().routes.slice();
}

function observationEvents() {
  return new Set(_load().observationEvents);
}

function isObservationEvent(eventName) {
  return _load().observationEvents.has(eventName);
}

function policyContext(eventName) {
  const r = routeFor(eventName);
  if (r && Object.prototype.hasOwnProperty.call(r, 'policyContext')) return r.policyContext;
  return eventName;
}

function lifecycleScripts(eventName) {
  const r = routeFor(eventName);
  return r && Array.isArray(r.scripts) ? r.scripts.slice() : [];
}

function shellByTool(eventName) {
  const r = routeFor(eventName);
  const table = r && r.shellByTool && typeof r.shellByTool === 'object' ? r.shellByTool : {};
  const out = {};
  for (const [tool, scripts] of Object.entries(table)) {
    out[tool] = Array.isArray(scripts) ? scripts.slice() : [];
  }
  return out;
}

function universalScripts(eventName) {
  const r = routeFor(eventName);
  return r && Array.isArray(r.universalScripts) ? r.universalScripts.slice() : [];
}

function hmePrimerScript(eventName) {
  const r = routeFor(eventName);
  return r && typeof r.hmePrimerScript === 'string' ? r.hmePrimerScript : null;
}

function strictMode(eventName) {
  const r = routeFor(eventName);
  return r && typeof r.strictMode === 'string' ? r.strictMode : 'always';
}

module.exports = {
  ROUTES_FILE,
  routeFor,
  routes,
  observationEvents,
  isObservationEvent,
  policyContext,
  lifecycleScripts,
  shellByTool,
  universalScripts,
  hmePrimerScript,
  strictMode,
  resetForTests,
};
