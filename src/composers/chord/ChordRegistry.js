// ChordRegistry.js - registry for chord-related generators and helpers (fail-fast)

ChordRegistry = (function() {
  const _map = {};

  function register(name, fn) {
    if (!name || typeof name !== 'string') throw new Error('ChordRegistry.register: invalid name');
    if (typeof fn !== 'function') throw new Error(`ChordRegistry.register: generator for "${name}" must be a function`);
    if (_map[name]) throw new Error(`ChordRegistry.register: generator "${name}" already registered`);
    _map[name] = fn;
    return fn;
  }

  function registerMany(obj) {
    if (typeof obj !== 'object' || obj === null) throw new Error('ChordRegistry.registerMany: expected object');
    Object.entries(obj).forEach(([name, fn]) => register(name, fn));
  }

  function get(name) {
    if (!name || typeof name !== 'string') throw new Error('ChordRegistry.get: invalid name');
    const fn = _map[name];
    if (!fn) throw new Error(`ChordRegistry.get: unknown generator "${name}"`);
    return fn;
  }

  function list() { return Object.keys(_map); }

  function getAll() { return Object.assign({}, _map); }

  return {
    register,
    registerMany,
    get,
    list,
    getAll
  };
})();
