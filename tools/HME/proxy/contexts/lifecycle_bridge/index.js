'use strict';

function bridge(name) {
  return (...args) => require('../../lifecycle_bridge')[name](...args);
}
function from(modulePath, name) {
  return (...args) => require(modulePath)[name](...args);
}

module.exports = {
  handleLifecycleRoute: bridge('handleLifecycleRoute'),
  recordLifecycleHit: bridge('recordLifecycleHit'),
  lifecycleInactive: bridge('lifecycleInactive'),
  runInlineFallback: bridge('runInlineFallback'),
  emitStartMarker: from('../../start_marker', 'emitStartMarker'),
  createProxyRouteDispatcher: from('../../hme_proxy_routes', 'createProxyRouteDispatcher'),
  get lifecycleBridge() { return require('../../lifecycle_bridge'); },
  get hmeDispatcher() { return require('../../hme_dispatcher'); },
  get supervisorChildren() { return require('../../supervisor/children'); },
  get supervisor() { return require('../../supervisor'); },
};
