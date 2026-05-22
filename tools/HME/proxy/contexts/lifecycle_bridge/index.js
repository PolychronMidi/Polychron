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
const supervisorChildren = require('../../supervisor/children');
const supervisor = require('../../supervisor');

module.exports = {
  handleLifecycleRoute,
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
  emitStartMarker,
  createProxyRouteDispatcher,
  lifecycleBridge: lifecycleBridgeModule,
  hmeDispatcher,
  supervisorChildren,
  supervisor,
};
