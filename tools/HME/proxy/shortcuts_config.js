'use strict';

// Shared loader for tools/HME/config/shortcuts.json -- the single source of truth
// for input shortcuts. Read by the proxy middleware (wire lane: simple+two-step)

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'shortcuts.json');

function _load() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const simple = raw.simple && typeof raw.simple === 'object' ? raw.simple : {};
  const twoStep = raw['two-step'] && typeof raw['two-step'] === 'object' ? raw['two-step'] : {};
  const multiStep = raw['multi-step'] && typeof raw['multi-step'] === 'object' ? raw['multi-step'] : {};

  const wireKeys = new Set([...Object.keys(simple), ...Object.keys(twoStep)].map((k) => k.toLowerCase()));
  const localKeys = new Set(Object.keys(multiStep).map((k) => k.toLowerCase()));
  for (const k of localKeys) {
    if (wireKeys.has(k)) {
      throw new Error(`shortcuts.json: key "${k}" is in BOTH a wire lane (simple/two-step) and the local-session lane (multi-step). A shortcut belongs to exactly one lane.`);
    }
  }
  for (const [k, def] of Object.entries(multiStep)) {
    if (!def || !Array.isArray(def.steps) || def.steps.length === 0) {
      throw new Error(`shortcuts.json: multi-step "${k}" must define a non-empty "steps" array.`);
    }
    const mode = def.mode || 'exact';
    if (!['exact', 'prefix'].includes(mode)) {
      throw new Error(`shortcuts.json: multi-step "${k}" has invalid mode ${JSON.stringify(mode)}.`);
    }
  }
  return { simple, twoStep, multiStep };
}

const { simple: SHORTCUTS, twoStep: TWO_STEP_SHORTCUTS, multiStep: MULTI_STEP_SHORTCUTS } = _load();

// Text a typed shortcut expands to for the on-screen input bubble. Two-step
// shortcuts show their `first` message. Multi-step shortcuts are local-session
function shortcutDisplay(text) {
  const key = String(text == null ? '' : text).trim().toLowerCase();
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(SHORTCUTS, key)) return SHORTCUTS[key];
  if (Object.prototype.hasOwnProperty.call(TWO_STEP_SHORTCUTS, key)) return TWO_STEP_SHORTCUTS[key].first;
  return null;
}

function multiStepMatch(text) {
  const raw = String(text == null ? '' : text).trim();
  const keyText = raw.toLowerCase();
  if (!keyText) return null;
  if (Object.prototype.hasOwnProperty.call(MULTI_STEP_SHORTCUTS, keyText)) {
    return { key: keyText, prompt: '', mode: MULTI_STEP_SHORTCUTS[keyText].mode || 'exact' };
  }
  const prefixKeys = Object.keys(MULTI_STEP_SHORTCUTS)
    .filter((k) => (MULTI_STEP_SHORTCUTS[k].mode || 'exact') === 'prefix')
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  for (const key of prefixKeys) {
    if (keyText.startsWith(key)) return { key, prompt: raw.slice(key.length), mode: 'prefix' };
  }
  return null;
}

function multiStepKey(text) {
  const match = multiStepMatch(text);
  return match ? match.key : null;
}

function multiStepSteps(key, prompt = '') {
  const def = MULTI_STEP_SHORTCUTS[String(key || '').trim().toLowerCase()];
  if (!def || !Array.isArray(def.steps)) return null;
  return def.steps.map((step) => String(step).replace(/\$prompt/g, String(prompt || '')));
}

module.exports = {
  CONFIG_PATH,
  SHORTCUTS,
  TWO_STEP_SHORTCUTS,
  MULTI_STEP_SHORTCUTS,
  shortcutDisplay,
  multiStepMatch,
  multiStepKey,
  multiStepSteps,
};
