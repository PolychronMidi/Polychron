// StutterMetrics.js - metrics tracking for stutter scheduling/emission

const stutterMetrics = {
  scheduledCount: 0,
  emittedCount: 0,
  scheduledByProfile: {},
  emittedByProfile: {},
  pendingByTick: new Map()
};

function getMetrics() {
  return {
    scheduledCount: stutterMetrics.scheduledCount,
    emittedCount: stutterMetrics.emittedCount,
    scheduledByProfile: Object.assign({}, stutterMetrics.scheduledByProfile),
    emittedByProfile: Object.assign({}, stutterMetrics.emittedByProfile),
    pendingByTick: new Map(stutterMetrics.pendingByTick)
  };
}

function resetMetrics() {
  stutterMetrics.scheduledCount = 0;
  stutterMetrics.emittedCount = 0;
  stutterMetrics.scheduledByProfile = {};
  stutterMetrics.emittedByProfile = {};
  stutterMetrics.pendingByTick = new Map();
  return true;
}

function incScheduled(n = 1, profile = 'unknown') {
  stutterMetrics.scheduledCount += n;
  stutterMetrics.scheduledByProfile[profile] = (stutterMetrics.scheduledByProfile[profile] || 0) + n;
}

function incEmitted(n = 1, profile = 'unknown') {
  stutterMetrics.emittedCount += n;
  stutterMetrics.emittedByProfile[profile] = (stutterMetrics.emittedByProfile[profile] || 0) + n;
}

function incPendingForTick(tick, n = 1) {
  const key = Math.round(tick);
  stutterMetrics.pendingByTick.set(key, (stutterMetrics.pendingByTick.get(key) || 0) + n);
}

function decPendingForTick(tick, n = 1) {
  const key = Math.round(tick);
  const cur = stutterMetrics.pendingByTick.get(key) || 0;
  const next = Math.max(0, cur - n);
  if (next === 0) stutterMetrics.pendingByTick.delete(key); else stutterMetrics.pendingByTick.set(key, next);
}

StutterMetrics = {
  getMetrics,
  resetMetrics,
  incScheduled,
  incEmitted,
  incPendingForTick,
  decPendingForTick
};
