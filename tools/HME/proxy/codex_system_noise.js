'use strict';

// Strip Codex-injected system noise wrappers from body.input[].content[].

const { CODEX_SYSTEM_NOISE_RULES, itemText, classifyRemoveBlockText } = require('./system_noise_rules');

function classifyNoise(item) {
  const text = itemText(item);
  if (text == null) return '';
  return classifyRemoveBlockText(text, CODEX_WRAPPER_RULES);
}

function stripCodexSystemNoise(body, stats = {}) {
  stats.dropped = stats.dropped || 0;
  stats.removed_bytes = stats.removed_bytes || 0;
  stats.categories = stats.categories || {};
  if (!body || typeof body !== 'object' || !Array.isArray(body.input)) return body;
  let mutated = false;
  const nextInput = body.input.map((entry) => {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.content)) return entry;
    const kept = [];
    let entryMutated = false;
    for (const item of entry.content) {
      const category = classifyNoise(item);
      if (!category) { kept.push(item); continue; }
      stats.dropped += 1;
      stats.categories[category] = (stats.categories[category] || 0) + 1;
      stats.removed_bytes += Buffer.byteLength(itemText(item) || '');
      entryMutated = true;
    }
    if (!entryMutated) return entry;
    mutated = true;
    return { ...entry, content: kept };
  });
  return mutated ? { ...body, input: nextInput } : body;
}

module.exports = { stripCodexSystemNoise, WRAPPER_RULES: CODEX_WRAPPER_RULES };
