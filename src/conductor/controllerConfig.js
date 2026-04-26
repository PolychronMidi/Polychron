// controllerConfig.js -- Loads externalized meta-controller constants from
// output/metrics/controller-config.json (a pipeline-run artifact). Controllers
// read their section at boot; each call passes its own per-key fallback.
// Missing file -> empty config (first-run or fresh-clone case; callers supply
// defaults). Malformed JSON -> throw (corruption is not a graceful-degradation
// case per CLAUDE.md P2).

moduleLifecycle.declare({
  name: 'controllerConfig',
  subsystem: 'conductor',
  deps: [],
  provides: ['controllerConfig'],
  init: (deps) => {
  const _fs = require('fs');
  const _path = require('path');
  let _config = null;

  function _load() {
    if (_config) return _config;
    const configPath = _path.join(METRICS_DIR, 'controller-config.json');
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
  },
});
