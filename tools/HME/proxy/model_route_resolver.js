'use strict';

function disabled(value) { return ['0', 'false', 'off', 'direct', 'disabled'].includes(String(value || '').toLowerCase()); }
function modeFromEnv(env) {
  const raw = env.HME_CODEX_OMNIROUTE_MODE || env.HME_CODEX_OMNIROUTE || '';
  if (!raw || raw === '1' || raw === 'true') return '';
  return String(raw).toLowerCase();
}
function defaultOmniResponsesUrl(servicePort, env = process.env) {
  const port = env.HME_OMNIROUTE_PORT || servicePort('omniroute', env);
  return `http://127.0.0.1:${port}/v1/responses`;
}

function codexOmniConfig({ cfg = {}, env = process.env, servicePort }) {
  const mode = modeFromEnv(env) || cfg.mode || 'upstream';
  if (disabled(env.HME_CODEX_OMNIROUTE) || cfg.enabled === false || mode !== 'upstream') return { enabled: false };
  return {
    enabled: true,
    url: env.HME_CODEX_OMNIROUTE_URL || cfg.url || defaultOmniResponsesUrl(servicePort, env),
    providerPrefix: env.HME_CODEX_OMNIROUTE_PROVIDER || cfg.provider_prefix || 'cx',
    model: env.HME_CODEX_OMNIROUTE_MODEL || cfg.model || '',
    fallbackDirect: env.HME_CODEX_OMNIROUTE_FALLBACK_DIRECT !== '0' && cfg.fallback_direct !== false,
    fallbackHttpStatuses: new Set(cfg.fallback_http_statuses || [400, 401, 403, 404, 429, 500, 502, 503, 504]),
    apiKey: env.HME_CODEX_OMNIROUTE_API_KEY || cfg.api_key || '',
  };
}

function ensureResponsesInput(body) {
  if (Object.prototype.hasOwnProperty.call(body, 'input')) return body;
  if (Object.prototype.hasOwnProperty.call(body, 'messages')) return body;
  return { ...body, input: [] };
}

function codexTargetChain({ body, upstreamUrl, cfg = {}, env = process.env, servicePort }) {
  const omni = codexOmniConfig({ cfg: cfg.omniroute || cfg.codex_omniroute || {}, env, servicePort });
  const direct = { kind: 'direct', url: upstreamUrl, body, fallbackDirect: false };
  if (!omni.enabled) return [direct];
  const model = omni.model || body.model || '';
  const prefixed = model.includes('/') ? model : `${omni.providerPrefix}/${model}`;
  const omniBody = ensureResponsesInput({ ...body, model: prefixed });
  return [{ kind: 'omniroute', url: omni.url, body: omniBody, apiKey: omni.apiKey, fallbackDirect: omni.fallbackDirect, fallbackHttpStatuses: omni.fallbackHttpStatuses }, direct];
}

function targetSummary(targets) { return targets.map((t) => `${t.kind}:${t.body && t.body.model ? t.body.model : ''}`).join(' -> '); }

function routeDecision({ host, requestedModel, provider = '', protocol = '', route = '' }) {
  return { host, requested_model: requestedModel || '', provider, protocol, route, target_model: provider && requestedModel && !requestedModel.includes('/') ? `${provider}/${requestedModel}` : (requestedModel || '') };
}

module.exports = { codexOmniConfig, codexTargetChain, targetSummary, routeDecision };
