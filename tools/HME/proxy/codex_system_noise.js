'use strict';

// Strip Codex-injected system noise wrappers from body.input[].content[].
// Mirrors Claude-side 00_strip_skill_reminder remove-block rules.

const WRAPPER_RULES = [
  { name: 'permissions_instructions', re: /^<permissions instructions>[\s\S]*<\/permissions instructions>\s*$/ },
  { name: 'collaboration_mode',       re: /^<collaboration_mode>[\s\S]*<\/collaboration_mode>\s*$/ },
  { name: 'skills_instructions',      re: /^<skills_instructions>[\s\S]*<\/skills_instructions>\s*$/ },
];

const TEXT_TYPES = new Set(['input_text', 'output_text', 'text']);

function itemText(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  if (!TEXT_TYPES.has(String(item.type || ''))) return null;
  if (typeof item.text === 'string') return item.text;
  if (typeof item.content === 'string') return item.content;
  return null;
}

function classifyNoise(item) {
  const text = itemText(item);
  if (text == null) return '';
  for (const rule of WRAPPER_RULES) {
    if (rule.re.test(text)) return rule.name;
  }
  return '';
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

module.exports = { stripCodexSystemNoise, WRAPPER_RULES };
