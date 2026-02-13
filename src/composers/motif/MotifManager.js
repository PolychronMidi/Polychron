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

  // Proxy helpers from MotifValues
  function repeatPattern(pattern, times) { return (values && typeof values.repeatPattern === 'function') ? values.repeatPattern(pattern, times) : (() => { throw new Error('MotifManager.repeatPattern: MotifValues.repeatPattern not available'); })(); }
  function offsetPattern(pattern, offsetSteps) { return (values && typeof values.offsetPattern === 'function') ? values.offsetPattern(pattern, offsetSteps) : (() => { throw new Error('MotifManager.offsetPattern: MotifValues.offsetPattern not available'); })(); }
  function scaleDurations(pattern, scale) { return (values && typeof values.scaleDurations === 'function') ? values.scaleDurations(pattern, scale) : (() => { throw new Error('MotifManager.scaleDurations: MotifValues.scaleDurations not available'); })(); }

  return { listGenerators, getGenerator, generate, applyToNotes, repeatPattern, offsetPattern, scaleDurations };
})();
