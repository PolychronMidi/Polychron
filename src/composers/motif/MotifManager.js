// MotifManager.js - single manager hub for motif subsystem

MotifManager = (function() {
  const registry = MotifRegistry;
  const values = MotifValues;
  const mod = motifModulator;
  const config = motifConfig;

  function listGenerators() { return registry.list(); }

  function getGenerator(name) { return registry.get(name); }

  function generate(name, ...args) {
    if (!name) throw new Error('MotifManager.generate: name required');
    const gen = registry.get(name);
    return gen(...args);
  }

  function applyToNotes(notes, motifPattern, profileName, options = {}) {
    const profile = profileName ? config.getProfile(profileName) : {};
    const opts = Object.assign({}, profile, options);
    return mod.apply(notes, motifPattern, opts);
  }

  return { listGenerators, getGenerator, generate, applyToNotes };
})();
