'use strict';

const { servicePort } = require('./service_registry');

function disabled(value) {
  return ['0', 'false', 'off', 'direct', 'disabled'].includes(String(value || '').toLowerCase());
}

function modeFromEnv(env) {
  const raw = env.HME_CODEX_OMNIROUTE_MODE || env.HME_CODEX_OMNIROUTE || '';
  if (!raw || raw === '1' || raw === 'true') return '';
  return String(raw).toLowerCase();
}

function defaultOmniUrl(env) {
  const port = env.HME_OMNIROUTE_PORT || servicePort('omniroute', env);
  return `http://127.0.0.1:${port}/v1/responses`;
}

function prefixedModel(model, prefix) {
  const value = String(model || '').trim();
  if (!value || value.includes('/')) return value;
  return `${prefix}/${value}`;
}

function omniSpec(loadConfig, env = process.env) {
  const cfg = (loadConfig().omniroute || {});
  const mode = modeFromEnv(env) || cfg.mode || 'upstream';
  if (disabled(env.HME_CODEX_OMNIROUTE) || cfg.enabled === false || mode !== 'upstream') {
    return null;
  }
  return {
    kind: 'omniroute',
    url: env.HME_CODEX_OMNIROUTE_URL || cfg.url || defaultOmniUrl(env),
    providerPrefix: env.HME_CODEX_OMNIROUTE_PROVIDER || cfg.provider_prefix || 'cx',
    model: env.HME_CODEX_OMNIROUTE_MODEL || cfg.model || '',
    fallbackDirect: cfg.fallback_direct !== false,
    fallbackHttpStatuses: new Set(cfg.fallback_http_statuses || [400, 401, 403, 404, 429, 500, 502, 503, 504]),
    apiKey: env.HME_CODEX_OMNIROUTE_API_KEY || cfg.api_key || '',
  };
}

function bodyForOmni(body, spec) {
  const model = spec.model || prefixedModel(body.model, spec.providerPrefix);
  return model ? { ...body, model } : { ...body };
}

function targetChain(body, directUrl, loadConfig, env = process.env) {
  const direct = { kind: 'direct', url: directUrl, body, fallbackDirect: false };
  const spec = omniSpec(loadConfig, env);
  if (!spec) return [direct];
  return [{ ...spec, body: bodyForOmni(body, spec) }, direct];
}

function targetSummary(targets) {
  return targets.map((target) => ({
    kind: target.kind,
    url: target.url,
    model: target.body && target.body.model ? target.body.model : '',
  }));
}

module.exports = {
  targetChain,
  targetSummary,
};
