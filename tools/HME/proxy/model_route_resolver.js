'use strict';

function disabled(value) { return value === '0' || value === 'false' || value === 'off' || value === 'disabled'; }
function defaultOmniResponsesUrl(servicePort, env = process.env) { return `http://127.0.0.1:${servicePort('omniroute')}/v1/responses`; }

function codexOmniConfig({ cfg = {}, env = process.env, servicePort }) {
  const mode = env.HME_CODEX_OMNIROUTE_MODE || env.HME_CODEX_OMNIROUTE || '';
  if (disabled(env.HME_CODEX_OMNIROUTE) || cfg.enabled === false || mode !== 'upstream') return { enabled: false };
  return {
    enabled: true,
    url: env.HME_CODEX_OMNIROUTE_URL || cfg.url || defaultOmniResponsesUrl(servicePort, env),
    providerPrefix: env.HME_CODEX_OMNIROUTE_PROVIDER || cfg.provider_prefix || 'cx',
    model: env.HME_CODEX_OMNIROUTE_MODEL || cfg.model || '',
    fallbackDirect: env.HME_CODEX_OMNIROUTE_FALLBACK_DIRECT !== '0' && cfg.fallback_direct !== false,
    apiKey: env.HME_CODEX_OMNIROUTE_API_KEY || cfg.api_key || '',
  };
}

function codexTargetChain({ body, upstreamUrl, cfg = {}, env = process.env, servicePort }) {
  const omni = codexOmniConfig({ cfg: cfg.omniroute || cfg.codex_omniroute || {}, env, servicePort });
  const direct = { kind: 'direct', url: upstreamUrl, body, fallbackDirect: false };
  if (!omni.enabled) return [direct];
  const model = omni.model || body.model || '';
  const prefixed = model.includes('/') ? model : `${omni.providerPrefix}/${model}`;
  return [{ kind: 'omniroute', url: omni.url, body: { ...body, model: prefixed }, apiKey: omni.apiKey, fallbackDirect: omni.fallbackDirect, fallbackHttpStatuses: new Set([404, 502, 503, 504]) }, direct];
}

function targetSummary(targets) { return targets.map((t) => `${t.kind}:${t.body && t.body.model ? t.body.model : ''}`).join(' -> '); }

function routeDecision({ host, requestedModel, provider = '', protocol = '', route = '' }) {
  return { host, requested_model: requestedModel || '', provider, protocol, route, target_model: provider && requestedModel && !requestedModel.includes('/') ? `${provider}/${requestedModel}` : (requestedModel || '') };
}

module.exports = { codexOmniConfig, codexTargetChain, targetSummary, routeDecision };
