'use strict';

const lifecycleBridgeModule = require('../../lifecycle_bridge');
const {
  handleLifecycleRoute,
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
} = lifecycleBridgeModule;
const { emitStartMarker } = require('../../start_marker');
const { createProxyRouteDispatcher } = require('../../hme_proxy_routes');
const hmeDispatcher = require('../../hme_dispatcher');

module.exports = {
  handleLifecycleRoute,
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
  emitStartMarker,
  createProxyRouteDispatcher,
  lifecycleBridge: lifecycleBridgeModule,
  hmeDispatcher,
};
