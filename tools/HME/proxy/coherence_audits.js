'use strict';

const SECRET_KEY_RE = /^(raw_prompt|raw_request|raw_response|request_payload|response_payload|messages|api_key|password|secret|private_key|authorization)$/i;
const SECRET_VALUE_RE = /(AKIA[0-9A-Z]{16}|BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY|xox[baprs]-|sk-[A-Za-z0-9_-]{20,})/;

function _missing(obj, fields) {
  return fields.filter((f) => {
    const v = obj && obj[f];
    if (Array.isArray(v)) return v.length === 0;
    return typeof v === 'undefined' || v === null || String(v).trim() === '';
  });
}

function verifierSelfDoubtAudit(verifier = {}) {
  const required = ['intent_fit', 'bypass_blindness', 'false_positive_risk', 'false_negative_risk', 'actionability', 'fail_loud_mode', 'ceremony_gaming_risk'];
  const missing = _missing(verifier, required);
  return { ok: missing.length === 0, missing, required };
}

function metaRuleAudit(rule = {}) {
  const missing = [];
  if (!rule.warning_usefulness_proof) missing.push('warning_usefulness_proof');
  if (!rule.death_condition) missing.push('death_condition');
  if (!rule.repair_regression) missing.push('repair_regression');
  if (!rule.lineage_purpose) missing.push('lineage_purpose');
  if (!rule.currentness_proof) missing.push('currentness_proof');
  return { ok: missing.length === 0, missing };
}

function secretRedactionCheck(value, prefix = '$', findings = []) {
  if (value === null || value === undefined) return findings;
  if (typeof value === 'string') {
    if (SECRET_VALUE_RE.test(value)) findings.push({ path: prefix, reason: 'secret-looking string' });
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => secretRedactionCheck(v, `${prefix}[${i}]`, findings));
    return findings;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = `${prefix}.${k}`;
      if (SECRET_KEY_RE.test(k)) findings.push({ path: p, reason: 'forbidden raw/sensitive key' });
      else secretRedactionCheck(v, p, findings);
    }
  }
  return findings;
}

function evidenceDataMinimization(evidence = {}) {
  const findings = secretRedactionCheck(evidence);
  if (JSON.stringify(evidence).length > 8192) findings.push({ path: '$', reason: 'evidence payload too large; store hash/URI/excerpt only' });
  return { ok: findings.length === 0, findings };
}

function retentionPlan(store = {}, opts = {}) {
  const maxItems = Number.isFinite(opts.maxItems) ? opts.maxItems : 5000;
  const maxBytes = Number.isFinite(opts.maxBytes) ? opts.maxBytes : 5 * 1024 * 1024;
  const bytes = Buffer.byteLength(JSON.stringify(store));
  const items = Array.isArray(store) ? store.length : Object.keys(store.nodes || store).length;
  return {
    ok: items <= maxItems && bytes <= maxBytes,
    items,
    bytes,
    maxItems,
    maxBytes,
    action: items <= maxItems && bytes <= maxBytes ? 'keep' : 'compact_or_archive',
  };
}

module.exports = { verifierSelfDoubtAudit, metaRuleAudit, secretRedactionCheck, evidenceDataMinimization, retentionPlan };
