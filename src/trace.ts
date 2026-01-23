import { getPolychronContext } from './PolychronInit.js';

export type TraceMode = 'none' | 'anomaly' | 'deep' | 'full';

const modeRank: Record<TraceMode, number> = {
  none: 0,
  anomaly: 1,
  deep: 2,
  full: 3
};

const getConfiguredMode = (): TraceMode => {
  try {
    const poly = getPolychronContext();
    if (poly && poly.test && typeof poly.test._traceMode === 'string') {
      const m = poly.test._traceMode as TraceMode;
      if (m in modeRank) return m;
    }
  } catch (_e) {}
  const env = process.env.POLYCHRON_TRACE;
  if (env === 'full' || env === 'deep' || env === 'anomaly') return env as TraceMode;
  return 'none';
};

export const shouldTrace = (required: TraceMode): boolean => {
  try {
    const configured = getConfiguredMode();
    return modeRank[configured] >= modeRank[required];
  } catch (_e) {
    return false;
  }
};

export const trace = (required: TraceMode, ...args: any[]): void => {
  if (shouldTrace(required)) {
    try { console.error(...args); } catch (_e) {}
  }
};

export const traceWarn = (required: TraceMode, ...args: any[]): void => {
  if (shouldTrace(required)) {
    try { console.warn(...args); } catch (_e) {}
  }
};
