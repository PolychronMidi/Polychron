// traceDrain.js - Visual Diagnostic Mode.
// Captures per-beat conductor and cross-layer state continuously if --trace is passed.

traceDrain = (() => {

  let isTracing = false;
  let fd = null;
  const _buffer = [];
  const FLUSH_INTERVAL = 50; // flush every N records to reduce sync I/O calls
  let _recordCount = 0;

  // Per-beat note accumulator: collects emitted note data between playNotes and traceDrain.record
  /** @type {Array<{pitch: number, velocity: number, channel: number}>} */
  let _pendingNotes = [];

  function init() {
    if (!process.argv.includes('--trace')) return;
    isTracing = true;
    _recordCount = 0;
    _pendingNotes = [];

    const outDir = path.resolve(process.cwd(), 'metrics');
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    const filepath = path.join(outDir, 'trace.jsonl');

    // Clear out the old trace file to avoid runaway file sizes across multiple dev runs
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
      }
    } catch {
      // Non-fatal
    }

    fd = fs.openSync(filepath, 'a');
  }

  function isEnabled() {
    return isTracing && fd !== null;
  }

  /** Flush buffered records to disk in a single write. */
  function _flush() {
    if (_buffer.length === 0 || fd === null) return;
    fs.writeSync(fd, _buffer.join(''));
    _buffer.length = 0;
  }

  /**
   * Accumulate a note event for embedding in the next trace record.
   * Called from playNotesEmitPick for primary source channel notes.
   * @param {number} pitch - MIDI pitch (0-127)
   * @param {number} velocity - MIDI velocity (1-127)
   * @param {number} channel - MIDI channel
   */
  function recordNote(pitch, velocity, channel) {
    if (!isTracing) return;
    _pendingNotes.push({ pitch, velocity, channel });
  }

  /**
   * Record one trace beat entry.
   * @param {string} layer
  * @param {{ beatKey: string, timeMs: number, conductorSnap: any, negotiation: any, trustScores: any, regime: any, couplingMatrix: any, phaseTelemetry?: any, couplingTargets?: any, axisCouplingTotals?: Record<string,number>, axisEnergyShare?: { shares: Record<string,number>, axisGini: number }, couplingGates?: { gateD: number, gateT: number, gateF: number, floorDampen: number, bypassD: number, bypassT: number, bypassF: number }, couplingHomeostasis?: any, axisEnergyEquilibrator?: any, transitionReadiness?: any, profilerTelemetry?: any, outputLoadGuard?: any, forcedTransitionEvent?: any, stageTiming?: Record<string,number>|null }} data
   */
  function record(layer, data) {
    if (!isTracing || fd === null) return;
    const payload = {
      layer,
      beatKey: data.beatKey,
      timeMs: data.timeMs,
      snap: data.conductorSnap,
      negotiation: data.negotiation,
      trust: data.trustScores,
      regime: data.regime,
      coupling: data.couplingMatrix,
      phaseTelemetry: data.phaseTelemetry || undefined,
      couplingTargets: data.couplingTargets || undefined,
      axisCouplingTotals: data.axisCouplingTotals || undefined,
      axisEnergyShare: data.axisEnergyShare || undefined,
      couplingGates: data.couplingGates || undefined,
      couplingHomeostasis: data.couplingHomeostasis || undefined,
      axisEnergyEquilibrator: data.axisEnergyEquilibrator || undefined,
      transitionReadiness: data.transitionReadiness || undefined,
      profilerTelemetry: data.profilerTelemetry || undefined,
      outputLoadGuard: data.outputLoadGuard || undefined,
      forcedTransitionEvent: data.forcedTransitionEvent || undefined,
      notes: _pendingNotes.length > 0 ? _pendingNotes.slice() : undefined,
      stageTiming: data.stageTiming || undefined
    };
    // Clear accumulated notes after embedding
    _pendingNotes = [];

    _buffer.push(JSON.stringify(payload) + '\n');
    _recordCount++;
    if (_buffer.length >= FLUSH_INTERVAL) _flush();
  }

  // Mid-run diagnostic snapshot. Emitted periodically to capture
  // system state evolution beyond the beat-level trace window. The snapshot
  // includes key metrics that often diverge between early-run and end-of-run
  // (effectiveDim, trust scores, coupling means, gain multiplier, regime).
  let _snapshotCount = 0;

  /**
   * Record a diagnostic snapshot (non-beat).
   * @param {{ beatKey: string, timeMs: number, effectiveDim: number, trustScores: any, couplingMeans: Record<string,number>, globalGainMultiplier: number, regime: string, couplingStrength: number, phaseIntegrity: string }} data
   */
  function recordSnapshot(data) {
    if (!isTracing || fd === null) return;
    _snapshotCount++;
    const payload = {
      recordType: 'snapshot',
      snapshotIndex: _snapshotCount,
      beatKey: data.beatKey,
      timeMs: data.timeMs,
      effectiveDim: data.effectiveDim,
      trust: data.trustScores,
      couplingMeans: data.couplingMeans,
      globalGainMultiplier: data.globalGainMultiplier,
      regime: data.regime,
      couplingStrength: data.couplingStrength,
      phaseIntegrity: data.phaseIntegrity
    };
    _buffer.push(JSON.stringify(payload) + '\n');
    _recordCount++;
    if (_buffer.length >= FLUSH_INTERVAL) _flush();
  }

  function shutdown() {
    _flush();
    if (isTracing && _recordCount === 0) {
      console.warn('Acceptable warning: traceDrain recorded zero entries during traced run.');
    }
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Non-fatal
      }
      fd = null;
    }
  }

  return { init, isEnabled, record, recordNote, recordSnapshot, flush: _flush, shutdown };
})();
