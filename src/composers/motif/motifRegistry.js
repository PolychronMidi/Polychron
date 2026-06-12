// motifRegistry.js - registry for motif-related generators and helpers (fail-fast)

motifRegistry = (function() {
  const motifRegistryMap = {};

  function register(name, fn) {
    if (!name || typeof name !== 'string') throw new Error('motifRegistry.register: invalid name');
    if (typeof fn !== 'function') throw new Error(`motifRegistry.register: generator for "${name}" must be a function`);
    if (motifRegistryMap[name]) throw new Error(`motifRegistry.register: generator "${name}" already registered`);
    motifRegistryMap[name] = fn;
    return fn;
  }

  function registerMany(obj) {
    if (typeof obj !== 'object' || obj === null) throw new Error('motifRegistry.registerMany: expected object');
    Object.entries(obj).forEach(([name, fn]) => register(name, fn));
  }

  function get(name) {
    if (!name || typeof name !== 'string') throw new Error('motifRegistry.get: invalid name');
    const fn = motifRegistryMap[name];
    if (!fn) throw new Error(`motifRegistry.get: unknown generator "${name}"`);
    return fn;
  }

  function list() { return Object.keys(motifRegistryMap); }

  function getAll() { return Object.assign({}, motifRegistryMap); }

  return { register, registerMany, get, list, getAll };
})();
