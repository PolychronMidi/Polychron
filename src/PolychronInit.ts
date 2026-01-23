/**
 * PolychronInit - Initialize the PolychronContext singleton
 * Called from play.ts after all modules are imported
 * Populates the context with utilities and state references
 */

import PolychronContext from './PolychronContext.js';
import type { IPolychronContext } from './PolychronContext.js';
import * as Utils from './utils.js';
import * as Composers from './composers.js';
import { registerSheetConfig } from './sheet.js';

export function initializePolychronContext(): IPolychronContext {
  if (PolychronContext.initialized) {
    return PolychronContext;
  }

  // Populate utils directly from module imports to enforce DI-only usage
  PolychronContext.utils = {
    m: Math,
    clamp: Utils.clamp,
    modClamp: Utils.modClamp,
    lowModClamp: Utils.lowModClamp,
    highModClamp: Utils.highModClamp,
    scaleClamp: Utils.scaleClamp,
    scaleBoundClamp: Utils.scaleBoundClamp,
    softClamp: Utils.softClamp,
    stepClamp: Utils.stepClamp,
    logClamp: Utils.logClamp,
    expClamp: Utils.expClamp,
    rf: Utils.rf,
    ri: Utils.ri,
    ra: Utils.ra,
    rw: Utils.rw,
    rl: Utils.rl,
    rv: Utils.rv,
    randomFloat: Utils.randomFloat,
    randomInt: Utils.randomInt,
    randomLimitedChange: Utils.randomLimitedChange,
    randomVariation: Utils.randomVariation,
    randomWeightedInRange: Utils.randomWeightedInRange,
    randomWeightedInArray: Utils.randomWeightedInArray,
    randomWeightedSelection: Utils.randomWeightedSelection,
    normalizeWeights: Utils.normalizeWeights,
  };

  // ============================================================
  // POPULATE COMPOSERS (class references)
  // ============================================================
  // Populate composer class references with only provided exports. Advanced composers are optional and must be registered via DI if used.
  PolychronContext.composers = {
    MeasureComposer: Composers.MeasureComposer,
    ScaleComposer: Composers.ScaleComposer,
    RandomScaleComposer: Composers.RandomScaleComposer,
    ChordComposer: Composers.ChordComposer,
    RandomChordComposer: Composers.RandomChordComposer,
    ModeComposer: Composers.ModeComposer,
    RandomModeComposer: Composers.RandomModeComposer,
    PentatonicComposer: Composers.PentatonicComposer,
    RandomPentatonicComposer: Composers.RandomPentatonicComposer,
    ProgressionGenerator: Composers.ProgressionGenerator,

    // Advanced composers included when available for DI usage
    TensionReleaseComposer: Composers.TensionReleaseComposer,
    ModalInterchangeComposer: Composers.ModalInterchangeComposer,
    HarmonicRhythmComposer: Composers.HarmonicRhythmComposer,
    MelodicDevelopmentComposer: Composers.MelodicDevelopmentComposer,
    AdvancedVoiceLeadingComposer: Composers.AdvancedVoiceLeadingComposer,
  };

  // ============================================================
  // POPULATE STATE (mutable state copied from context defaults)
  // ============================================================
  PolychronContext.state = {
    bpmRatio: 1,
    measureCount: 0,
    subdivStart: 0,
    tpSec: 0,
    subdivsOn: 0,
    subdivsOff: 0,
    divsOn: 0,
    divsOff: 0,
    beatsOn: 0,
    beatsOff: 0,
    numerator: 0,
    denominator: 0,
    divisions: 0,
    subdivisions: 0,
    beatsUntilBinauralShift: 0,
  };

  // Instrumentation: wrap state in a Proxy to trace writes to `totalSections` so
  // we can find who writes invalid values (stack + timestamp recorded in test ns).
  try {
    const _origState: any = PolychronContext.state;
    const handler: ProxyHandler<any> = {
      set(target, prop, value, receiver) {
        const propName = String(prop);
        if (propName === 'totalSections') {
          const rawStack = new Error().stack;
          const stackTrace = rawStack ? rawStack.split('\n').slice(1).join('\n') : undefined;
          try { console.info('[traceroute] PolychronContext.state.totalSections write', { value, stackTrace }); } catch (_e) {}
          PolychronContext.test = PolychronContext.test || {} as any;
          (PolychronContext.test as any).lastTotalSectionsWrite = { value, stackTrace, ts: Date.now() };
          // Optional strict mode: enable via env var or poly.test.strictTotalSections flag
          const strict = Boolean(process.env.POLYCHRON_STRICT_TOTALSECTIONS) || Boolean((PolychronContext.test as any).strictTotalSections);
          if (strict) {
            if (!Number.isFinite(value) || Number(value) < 1) {
              throw new Error(`Invalid totalSections write detected: ${String(value)}`);
            }
          }
        }
        return Reflect.set(target, prop, value, receiver);
      }
    };
    PolychronContext.state = new Proxy(_origState, handler) as any;
  } catch (_e) {
    // Non-fatal: if Proxy is not available (very old environments), fall back silently
  }

  // ============================================================
  // POPULATE TEST NAMESPACE (test-only state)
  // Use DI-friendly setter to avoid runtime global reliance
  // ============================================================
  PolychronContext.test = PolychronContext.test || {};

  // Install a guarded Proxy to detect *invalid* writes to poly.state.totalSections.
  // Policy: record counts, capture only up to the first few invalid samples (stack), and
  // only emit a compact summary at the end of the run. This avoids per-write log noise.
  try {
    PolychronContext.test.strictTotalSections = !!PolychronContext.test.strictTotalSections;
    PolychronContext.test._totalSectionsWriteCount = PolychronContext.test._totalSectionsWriteCount || 0;
    PolychronContext.test._totalSectionsBadCount = PolychronContext.test._totalSectionsBadCount || 0;
    PolychronContext.test._totalSectionsBadSamples = PolychronContext.test._totalSectionsBadSamples || [];

    // Reporting helper: emits a compact summary (safe to call multiple times)
    PolychronContext.test._reportTotalSectionsWrites = () => {
      try {
        const total = PolychronContext.test._totalSectionsWriteCount || 0;
        const bad = PolychronContext.test._totalSectionsBadCount || 0;
        if (!bad && total > 0) {
          console.error('[trace-summary] totalSections writes', { totalWrites: total });
          return;
        }
        if (bad) {
          const sample = PolychronContext.test._totalSectionsBadSamples || [];
          // Use a warning severity and avoid printing a raw Error string to prevent alarm
          console.warn('[trace-summary] INVALID totalSections writes', { totalWrites: total, badWrites: bad, samples: sample.slice(0, 3).map((s: any) => ({ value: s.value, stackSnippet: (s.stackTrace || '').split('\n')[0] })) });
        }
      } catch (_e) {
        // non-fatal
      }
    };

    if (!(PolychronContext as any)._totalSectionsProxyInstalled) {
      const origState = PolychronContext.state || {} as any;
      PolychronContext.state = new Proxy(origState, {
        set(target: any, prop: string | symbol, value: any) {
          try {
            if (prop === 'totalSections') {
              const v = Number(value);
              PolychronContext.test._totalSectionsWriteCount++;
              const isBad = !Number.isFinite(v) || v < 1;
              if (isBad) {
                PolychronContext.test._totalSectionsBadCount++;
                // Capture a small number of bad samples (value + stack) for diagnostics
                if ((PolychronContext.test._totalSectionsBadSamples || []).length < 3) {
                  try {
                    const raw = new Error().stack;
                    const stackTrace = raw ? raw.split('\n').slice(1).join('\n') : '<stack unavailable>';
                    PolychronContext.test._totalSectionsBadSamples.push({ value, stackTrace });
                  } catch (_e) {
                    PolychronContext.test._totalSectionsBadSamples.push({ value, stackTrace: '<stack unavailable>' });
                  }
                }
                // Emit only minimal, sampled output for invalid writes (first few + sparse sampling)
                const FIRST = 3;
                const SAMPLE = 1000;
                const badCount = PolychronContext.test._totalSectionsBadCount;
                if (badCount <= FIRST || (badCount % SAMPLE) === 0) {
                  const lastSample = (badCount <= FIRST && PolychronContext.test._totalSectionsBadSamples.length)
                    ? PolychronContext.test._totalSectionsBadSamples[PolychronContext.test._totalSectionsBadSamples.length - 1]
                    : undefined;
                  console.warn('[trace] INVALID totalSections write (sampled)', { value, badCount, strict: PolychronContext.test.strictTotalSections, stackSnippet: lastSample ? (lastSample.stackTrace || '').split('\n')[0] : undefined });
                }
                if (PolychronContext.test.strictTotalSections) {
                  throw new Error('Invalid totalSections write: ' + String(value));
                }
              }
            }
          } catch (_e) {
            // never allow tracing to break initialization
          }
          (target as any)[prop as any] = value;
          return true;
        }
      });
      (PolychronContext as any)._totalSectionsProxyInstalled = true;
    }
  } catch (_e) {
    // Non-fatal: tracing is best-effort
  }

  // ============================================================
  // MARK AS INITIALIZED
  // ============================================================
  PolychronContext.initialized = true;

  // Register sheet-level configuration for legacy test compatibility
  // without writing to the real global object
  try {
    registerSheetConfig(PolychronContext);
  } catch (e) {
    // Non-fatal: registration is best-effort for tests; do not block initialization
    // but report in debug traces if enabled
    if (PolychronContext.test?.enableLogging) {
      console.debug('[PolychronInit] registerSheetConfig failed', e);
    }
  }

  return PolychronContext;
}

/**
 * Get the PolychronContext singleton (lazy initialization)
 */
export function getPolychronContext(): IPolychronContext {
  if (!PolychronContext.initialized) {
    return initializePolychronContext();
  }
  return PolychronContext;
}

export function setPolychronTestNamespace(ns: any): void {
  PolychronContext.test = ns || {};
}

export default PolychronContext;
