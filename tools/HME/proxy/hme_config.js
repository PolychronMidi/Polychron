'use strict';

const { requireEnv, requireEnvInt, requireEnvBool } = require('./shared/load_env');

function readOptional(name) {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw : '';
}

let _cached = null;

function load() {
  if (_cached) return _cached;
  const cfg = {
    projectRoot: requireEnv('PROJECT_ROOT'),
    pythonPath: requireEnv('PYTHONPATH'),
    proxy: {
      port: requireEnvInt('HME_PROXY_PORT'),
      upstreamHost: requireEnv('HME_PROXY_UPSTREAM_HOST'),
      upstreamPort: requireEnvInt('HME_PROXY_UPSTREAM_PORT'),
      upstreamTls: requireEnvBool('HME_PROXY_UPSTREAM_TLS'),
    },
    worker: {
      transport: requireEnv('HME_WORKER_TRANSPORT'),
    },
    overdrive: {
      mode: requireEnv('OVERDRIVE_MODE'),
      timeoutSecs: requireEnvInt('OVERDRIVE_TIMEOUT'),
    },
    omniroute: {
      port: requireEnvInt('HME_OMNIROUTE_PORT'),
    },
    paths: {
      runtime: requireEnv('HME_RUNTIME_DIR'),
      metrics: requireEnv('HME_METRICS_DIR'),
      state: requireEnv('HME_STATE_DIR'),
    },
    optional: {
      opencodeApiKey: readOptional('OPENCODE_API_KEY'),
      omniroutePassword: readOptional('OMNIROUTE_ADMIN_PASSWORD'),
    },
  };
  _cached = Object.freeze(deepFreeze(cfg));
  return _cached;
}

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.freeze(obj);
    for (const key of Object.keys(obj)) {
      const v = obj[key];
      if (v && typeof v === 'object') deepFreeze(v);
    }
  }
  return obj;
}

function reset() {
  _cached = null;
}

module.exports = { load, reset };
