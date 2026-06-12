// chordRegistry.js - registry for chord-related generators and helpers (fail-fast)

chordRegistry = (function() {
  const chordRegistryMap = {};

  function register(name, fn) {
    if (!name || typeof name !== 'string') throw new Error('chordRegistry.register: invalid name');
    if (typeof fn !== 'function') throw new Error(`chordRegistry.register: generator for "${name}" must be a function`);
    if (chordRegistryMap[name]) throw new Error(`chordRegistry.register: generator "${name}" already registered`);
    chordRegistryMap[name] = fn;
    return fn;
  }

  function registerMany(obj) {
    if (typeof obj !== 'object' || obj === null) throw new Error('chordRegistry.registerMany: expected object');
    Object.entries(obj).forEach(([name, fn]) => register(name, fn));
  }

  function get(name) {
    if (!name || typeof name !== 'string') throw new Error('chordRegistry.get: invalid name');
    const fn = chordRegistryMap[name];
    if (!fn) throw new Error(`chordRegistry.get: unknown generator "${name}"`);
    return fn;
  }

  function list() { return Object.keys(chordRegistryMap); }

  function getAll() { return Object.assign({}, chordRegistryMap); }

  return {
    register,
    registerMany,
    get,
    list,
    getAll
  };
})();
