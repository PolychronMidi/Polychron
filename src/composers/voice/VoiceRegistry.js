// VoiceRegistry.js - small registry for voice-related strategies and helpers (fail-fast)

VoiceRegistry = (function() {
  const _map = {};
  function register(name, fn) {
    if (!name || typeof name !== 'string') throw new Error('VoiceRegistry.register: invalid name');
    if (typeof fn !== 'function') throw new Error(`VoiceRegistry.register: strategy for "${name}" must be a function`);
    if (_map[name]) throw new Error(`VoiceRegistry.register: strategy "${name}" already registered`);
    _map[name] = fn;
    return fn;
  }
  function get(name) {
    if (!name || typeof name !== 'string') throw new Error('VoiceRegistry.get: invalid name');
    const fn = _map[name];
    if (!fn) throw new Error(`VoiceRegistry.get: unknown strategy "${name}"`);
    return fn;
  }
  function list() { return Object.keys(_map); }
  function getAll() { return Object.assign({}, _map); }
  return { register, get, list, getAll };
})();
