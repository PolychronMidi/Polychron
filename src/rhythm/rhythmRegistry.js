// rhythmRegistry.js - simple registry for rhythm generators (fail-fast)

rhythmRegistry = (function() {
  const _map = {};

  function register(name, fn) {
    if (!name || typeof name !== 'string') throw new Error('rhythmRegistry.register: invalid name');
    if (typeof fn !== 'function') throw new Error(`rhythmRegistry.register: generator for "${name}" must be a function`);
    if (_map[name]) throw new Error(`rhythmRegistry.register: generator "${name}" already registered`);
    _map[name] = fn;
    return fn;
  }

  function registerMany(obj) {
    if (typeof obj !== 'object' || obj === null) throw new Error('rhythmRegistry.registerMany: expected object');
    Object.entries(obj).forEach(([name, fn]) => register(name, fn));
  }

  function get(name) {
    if (!name || typeof name !== 'string') throw new Error('rhythmRegistry.get: invalid name');
    const fn = _map[name];
    if (!fn) throw new Error(`rhythmRegistry.get: unknown generator "${name}"`);
    return fn;
  }

  function list() { return Object.keys(_map); }

  function getAll() { return Object.assign({}, _map); }

  function execute(name, ...args) {
    const fn = get(name); // Will throw if name not found
    return fn(...args);   // Fail-fast: let any strategy error bubble
  }

  return {
    register,
    registerMany,
    get,
    execute,
    list,
    getAll
  };
})();
