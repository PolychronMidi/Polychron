'use strict';
const path = require('path');
const { loadJsonc } = require('./config_loader');

const PROJECT_ROOT = process.env.PROJECT_ROOT || path.resolve(__dirname, '..', '..', '..');
const FALLBACK_ROOT = path.resolve(__dirname, '..', '..', '..');
const REGISTRY_PATH = (() => {
  const candidate = path.join(PROJECT_ROOT, 'tools', 'HME', 'config', 'services.json');
  try {
    require('fs').accessSync(candidate);
    return candidate;
  } catch (_) {
    return path.join(FALLBACK_ROOT, 'tools', 'HME', 'config', 'services.json');
  }
})();

let _services = null;

function services() {
  if (_services) return _services;
  const data = loadJsonc(REGISTRY_PATH);
  if (!Array.isArray(data.services)) throw new Error(`${REGISTRY_PATH}: services must be a list`);
  _services = data.services;
  return _services;
}

function service(id) {
  const hit = services().find((s) => s && s.id === id);
  if (!hit) throw new Error(`unknown HME service: ${id}`);
  return hit;
}

function servicePort(id, env = process.env) {
  const spec = service(id);
  const raw = env[spec.env_port];
  const value = raw === undefined || raw === null || raw === '' ? spec.default_port : raw;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`${spec.env_port || id}="${value}" is not a valid port (1-65535)`);
  }
  return n;
}

function serviceHost(id) {
  return service(id).host || '127.0.0.1';
}

function servicePath(id) {
  const p = service(id).health_path || '/health';
  return p.startsWith('/') ? p : `/${p}`;
}

function serviceUrl(id, opts = {}) {
  const p = opts.path || servicePath(id);
  return `http://${serviceHost(id)}:${servicePort(id)}${p.startsWith('/') ? p : `/${p}`}`;
}

function serviceEnabled(id, env = process.env) {
  const rule = service(id).enabled_when;
  if (!rule) return true;
  if (rule.unless_env && env[rule.unless_env] === String(rule.unless_value || '1')) return false;
  return Boolean(rule.env && Array.isArray(rule.in) && rule.in.map(String).includes(String(env[rule.env] || '')));
}

function servicePidLabel(id) {
  const spec = service(id);
  return spec.pid_label || spec.id;
}

function supervisedChildren(parentId, opts = {}) {
  return services().filter((spec) => {
    if (!spec || spec.supervised_by !== parentId) return false;
    if (opts.requiredOnly && !spec.required) return false;
    return serviceEnabled(spec.id, opts.env || process.env);
  });
}

function bundleServices(parentId, opts = {}) {
  return [service(parentId), ...supervisedChildren(parentId, opts)];
}

function bundleProcessPatterns(parentId) {
  const out = [];
  for (const spec of bundleServices(parentId)) {
    for (const pat of spec.process_patterns || []) {
      if (pat && !out.includes(pat)) out.push(pat);
    }
  }
  return out;
}

function bundlePidLabels(parentId) {
  return bundleServices(parentId).map((spec) => spec.pid_label || spec.id);
}

module.exports = {
  REGISTRY_PATH,
  services,
  service,
  servicePort,
  serviceHost,
  servicePath,
  serviceUrl,
  serviceEnabled,
  servicePidLabel,
  supervisedChildren,
  bundleServices,
  bundleProcessPatterns,
  bundlePidLabels,
};
