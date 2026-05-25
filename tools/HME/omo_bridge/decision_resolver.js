const { assertUniversalDecision, validateUniversalDecision } = require('./universal_decision');

const MUTATING_KINDS = Object.freeze(['drop', 'rewrite', 'inject', 'modify']);
const TERMINAL_ORDER = Object.freeze(['critical_deny', 'deny', 'ask_permission', 'mutate', 'allow_defer']);

function sourceOf(item, index) {
  return { plugin: item.plugin || `decision_${index}`, trust: item.trust || 'optional', order: Number.isFinite(item.order) ? item.order : index };
}

function decisionRecord(item, index) {
  const decision = item && item.decision ? item.decision : item;
  return { decision, source: sourceOf(item || {}, index), index };
}

function validRecords(items = []) {
  const records = [];
  const invalid = [];
  items.forEach((item, index) => {
    const record = decisionRecord(item, index);
    const validation = validateUniversalDecision(record.decision);
    if (validation.valid) records.push(record);
    else invalid.push({ ...record.source, errors: validation.errors });
  });
  return { records, invalid };
}

function isCriticalDeny(record) {
  return record.decision.kind === 'deny' && (record.decision.severity === 'critical' || record.decision.critical === true || record.source.trust === 'kernel');
}

function mergeEffects(records) {
  return records.flatMap((record) => (record.decision.effects || []).map((effect) => ({ ...effect, plugin: record.source.plugin, trust: record.source.trust })));
}

function composeChatParamMods(records) {
  const patch = {};
  for (const record of records) {
    const incoming = record.decision.patch || {};
    for (const [key, value] of Object.entries(incoming)) {
      if (Object.prototype.hasOwnProperty.call(patch, key) && JSON.stringify(patch[key]) !== JSON.stringify(value)) {
        return {
          conflict: {
            kind: 'deny',
            reason: `Conflicting chat.params patch for ${key}`,
            machineCode: 'universal_decision_conflict',
            severity: 'critical',
          },
        };
      }
      patch[key] = value;
    }
  }
  return { decision: { kind: 'modify', target: 'chat.params', patch, reason: 'composed chat.params patches' } };
}

function pickMutation(records) {
  const mods = records.filter((record) => record.decision.kind === 'modify' && record.decision.target === 'chat.params');
  if (mods.length > 1 && mods.length === records.length) return composeChatParamMods(mods);
  return { decision: records[0].decision };
}

function resolveUniversalDecisions(items = []) {
  const { records, invalid } = validRecords(items);
  if (invalid.length) {
    return {
      decision: { kind: 'deny', reason: 'Invalid universal decision', machineCode: 'invalid_universal_decision', severity: 'critical' },
      reasonCode: 'invalid_universal_decision',
      invalid,
      effects: [],
      order: TERMINAL_ORDER,
    };
  }
  if (!records.length) return { decision: { kind: 'allow' }, reasonCode: 'default_allow', effects: [], order: TERMINAL_ORDER };

  const criticalDeny = records.find(isCriticalDeny);
  if (criticalDeny) return { decision: criticalDeny.decision, reasonCode: criticalDeny.decision.machineCode || 'critical_deny', effects: mergeEffects(records), source: criticalDeny.source, order: TERMINAL_ORDER };

  const deny = records.find((record) => record.decision.kind === 'deny');
  if (deny) return { decision: deny.decision, reasonCode: deny.decision.machineCode || 'deny', effects: mergeEffects(records), source: deny.source, order: TERMINAL_ORDER };

  const ask = records.find((record) => record.decision.kind === 'ask_permission');
  if (ask) return { decision: ask.decision, reasonCode: ask.decision.machineCode || 'ask_permission', effects: mergeEffects(records), source: ask.source, order: TERMINAL_ORDER };

  const mutations = records.filter((record) => MUTATING_KINDS.includes(record.decision.kind));
  if (mutations.length) {
    const picked = pickMutation(mutations);
    if (picked.conflict) return { decision: picked.conflict, reasonCode: 'universal_decision_conflict', effects: mergeEffects(records), order: TERMINAL_ORDER };
    assertUniversalDecision(picked.decision);
    return { decision: picked.decision, reasonCode: picked.decision.machineCode || picked.decision.kind, effects: mergeEffects(records), order: TERMINAL_ORDER };
  }

  const defer = records.find((record) => record.decision.kind === 'defer');
  return { decision: defer ? defer.decision : { kind: 'allow' }, reasonCode: defer ? 'defer' : 'allow', effects: mergeEffects(records), order: TERMINAL_ORDER };
}

module.exports = { TERMINAL_ORDER, resolveUniversalDecisions };
