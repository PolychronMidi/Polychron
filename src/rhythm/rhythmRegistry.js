// rhythmRegistry.js - simple registry for rhythm generators (fail-fast)

rhythmRegistry = (function() {
  const V = validator.create('rhythmRegistry');
  const _map = {};

  function register(name, fn) {
    V.assertNonEmptyString(name, 'register.name');
    V.requireType(fn, 'function', 'register.fn');
    if (_map[name]) throw new Error(`rhythmRegistry.register: generator "${name}" already registered`);
    _map[name] = fn;
    return fn;
  }

  function registerMany(obj) {
    V.assertPlainObject(obj, 'registerMany.obj');
    Object.entries(obj).forEach(([name, fn]) => register(name, fn));
  }

  function get(name) {
    V.assertNonEmptyString(name, 'get.name');
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
