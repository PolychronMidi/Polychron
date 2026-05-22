'use strict';

const {
  handleLifecycleRoute,
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
} = require('../../lifecycle_bridge');
const { emitStartMarker } = require('../../start_marker');

module.exports = {
  handleLifecycleRoute,
  recordLifecycleHit,
  lifecycleInactive,
  runInlineFallback,
  emitStartMarker,
};
