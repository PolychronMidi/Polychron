'use strict';

const CREDENTIAL_KEYWORDS = /auth|credential|api[_ -]?key|invalid[_ -]?key|no credentials|forbidden|unauthorized/i;

function classifyFailure(status, errInfo) {
  const type = String(errInfo && errInfo.type || '').toLowerCase();
  const code = String(errInfo && errInfo.code || '').toLowerCase();
  const message = String(errInfo && errInfo.message || '');
  const text = `${type} ${message} ${code}`;
  if (status === 429 || type === 'rate_limit_error') return 'rate_limit';
  if (type === 'stream_timeout' || code === 'stream_readiness_timeout' || /STREAM_READINESS_TIMEOUT|stream_timeout/i.test(text)) return 'stream_timeout';
  if (/input exceeds the context window/i.test(message)) return 'context_window';
  if ([400, 401, 403].includes(status) && CREDENTIAL_KEYWORDS.test(text)) return 'credential_failure';
  if (status >= 500 && status < 600) return 'upstream_5xx';
  if (status >= 400 && status < 500) return 'client_4xx';
  return 'unknown';
}

const POLICY_TABLE = {
  rate_limit: {
    description: 'Provider exhausted quota or interval cap',
    actions: ['refresh_oauth_if_oauth', 'retry_same_target', 'advance_chain'],
  },
  stream_timeout: {
    description: 'Upstream closed SSE empty / 502 stream_timeout',
    actions: ['retry_same_target_once', 'advance_chain'],
  },
  context_window: {
    description: 'Payload exceeds the model context window',
    actions: ['quarantine_route', 'retry_next_with_tail'],
  },
  credential_failure: {
    description: '4xx with auth/credential keywords -- key/token rejected',
    actions: ['quarantine_route', 'try_next_chain_target'],
  },
  upstream_5xx: {
    description: 'Provider transient 5xx',
    actions: ['retry_same_target_once', 'advance_chain'],
  },
  client_4xx: {
    description: 'Generic 4xx other than the typed cases',
    actions: ['surface_to_client'],
  },
  unknown: {
    description: 'Status / type combination not classified',
    actions: ['surface_to_client'],
  },
};

function policyFor(status, errInfo) {
  const kind = classifyFailure(status, errInfo);
  return { kind, ...POLICY_TABLE[kind] };
}

function actionsFor(status, errInfo) {
  return policyFor(status, errInfo).actions.slice();
}

module.exports = {
  classifyFailure,
  policyFor,
  actionsFor,
  POLICY_TABLE,
};
