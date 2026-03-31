const V = validator.create('stutterMetrics');
// stutterMetrics.js - lightweight metrics for stutter scheduling/emission

const stutterMetricsState = {
  scheduledCount: 0,
  emittedCount: 0,
  scheduledByProfile: {},
  emittedByProfile: {},
  variantCounts: {},
  pendingByTick: new Map()
};

function getMetrics() {
  return {
    scheduledCount: stutterMetricsState.scheduledCount,
    emittedCount: stutterMetricsState.emittedCount,
    scheduledByProfile: Object.assign({}, stutterMetricsState.scheduledByProfile),
    emittedByProfile: Object.assign({}, stutterMetricsState.emittedByProfile),
    variantCounts: Object.assign({}, stutterMetricsState.variantCounts),
    pendingByTick: new Map(stutterMetricsState.pendingByTick)
  };
}

function resetMetrics() {
  stutterMetricsState.scheduledCount = 0;
  stutterMetricsState.emittedCount = 0;
  stutterMetricsState.scheduledByProfile = {};
  stutterMetricsState.emittedByProfile = {};
  stutterMetricsState.variantCounts = {};
  stutterMetricsState.pendingByTick = new Map();
  return true;
}

function incScheduled(n = 1, profile = 'unknown') {
  stutterMetricsState.scheduledCount += n;
  stutterMetricsState.scheduledByProfile[profile] = (V.optionalFinite(stutterMetricsState.scheduledByProfile[profile], 0)) + n;
}

function incEmitted(n = 1, profile = 'unknown') {
  stutterMetricsState.emittedCount += n;
  stutterMetricsState.emittedByProfile[profile] = (V.optionalFinite(stutterMetricsState.emittedByProfile[profile], 0)) + n;
}

function incPendingForTick(tick, n = 1) {
  const key = m.round(tick);
  stutterMetricsState.pendingByTick.set(key, (V.optionalFinite(stutterMetricsState.pendingByTick.get(key), 0)) + n);
}

function decPendingForTick(tick, n = 1) {
  const key = m.round(tick);
  const cur = V.optionalFinite(stutterMetricsState.pendingByTick.get(key), 0);
  const next = m.max(0, cur - n);
  if (next === 0) stutterMetricsState.pendingByTick.delete(key); else stutterMetricsState.pendingByTick.set(key, next);
}

function incVariant(name) {
  const key = (name === null || name === undefined) ? 'default' : name;
  stutterMetricsState.variantCounts[key] = (V.optionalFinite(stutterMetricsState.variantCounts[key], 0)) + 1;
}

stutterMetrics = {
  getMetrics,
  resetMetrics,
  incScheduled,
  incEmitted,
  incVariant,
  incPendingForTick,
  decPendingForTick
};
