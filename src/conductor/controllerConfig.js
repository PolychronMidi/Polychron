// controllerConfig.js -- Loads externalized meta-controller constants from
// metrics/controller-config.json. Controllers read their section at boot.
// Falls back to hardcoded defaults if file is missing or malformed.

controllerConfig = (() => {
  const _fs = require('fs');
  const _path = require('path');
  let _config = null;

  function _load() {
    if (_config) return _config;
    const configPath = _path.join(process.cwd(), 'metrics', 'controller-config.json');
    if (!_fs.existsSync(configPath)) {
      _config = {};
      return _config;
    }
    _config = JSON.parse(_fs.readFileSync(configPath, 'utf8'));
    return _config;
  }

  function get(controller, key, fallback) {
    const cfg = _load();
    const section = cfg[controller];
    if (!section || !(key in section)) return fallback;
    return section[key];
  }

  function getSection(controller) {
    const cfg = _load();
    return cfg[controller] || {};
  }

  // Force reload (for hot-reload scenarios)
  function reload() {
    _config = null;
    _load();
  }

  return { get, getSection, reload };
})();
