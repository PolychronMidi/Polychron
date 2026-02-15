// StutterMetrics.js - lightweight metrics for stutter scheduling/emission

const _m = {
  scheduledCount: 0,
  emittedCount: 0,
  scheduledByProfile: {},
  emittedByProfile: {},
  pendingByTick: new Map()
};

function getMetrics() {
  return {
    scheduledCount: _m.scheduledCount,
    emittedCount: _m.emittedCount,
    scheduledByProfile: Object.assign({}, _m.scheduledByProfile),
    emittedByProfile: Object.assign({}, _m.emittedByProfile),
    pendingByTick: new Map(_m.pendingByTick)
  };
}

function resetMetrics() {
  _m.scheduledCount = 0;
  _m.emittedCount = 0;
  _m.scheduledByProfile = {};
  _m.emittedByProfile = {};
  _m.pendingByTick = new Map();
  return true;
}

function incScheduled(n = 1, profile = 'unknown') {
  _m.scheduledCount += n;
  _m.scheduledByProfile[profile] = (_m.scheduledByProfile[profile] || 0) + n;
}

function incEmitted(n = 1, profile = 'unknown') {
  _m.emittedCount += n;
  _m.emittedByProfile[profile] = (_m.emittedByProfile[profile] || 0) + n;
}

function incPendingForTick(tick, n = 1) {
  const key = m.round(tick);
  _m.pendingByTick.set(key, (_m.pendingByTick.get(key) || 0) + n);
}

function decPendingForTick(tick, n = 1) {
  const key = m.round(tick);
  const cur = _m.pendingByTick.get(key) || 0;
  const next = m.max(0, cur - n);
  if (next === 0) _m.pendingByTick.delete(key); else _m.pendingByTick.set(key, next);
}

StutterMetrics = {
  getMetrics,
  resetMetrics,
  incScheduled,
  incEmitted,
  incPendingForTick,
  decPendingForTick
};
