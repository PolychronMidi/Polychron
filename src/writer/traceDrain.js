// traceDrain.js - Visual Diagnostic Mode.
// Captures per-beat conductor and cross-layer state continuously if --trace is passed.

traceDrain = (() => {

  let isTracing = false;
  let fd = null;
  const traceDrainBuffer = [];
  const FLUSH_INTERVAL = 50; // flush every N records to reduce sync I/O calls
  let traceDrainRecordCount = 0;

  // Per-beat note accumulator: collects emitted note data between playNotes and traceDrain.record
  /** @type {Array<{pitch: number, velocity: number, channel: number}>} */
  let traceDrainPendingNotes = [];
  /** @type {Record<string, { totalMs: number, count: number, maxMs: number }>} */
  let traceDrainRuntimeBuckets = {};

  function traceDrainResetRuntimeBuckets() {
    traceDrainRuntimeBuckets = {};
  }

  function traceDrainRecordRuntimeMetric(name, durationMs) {
    if (!isTracing) return;
    const metricName = String(name || 'unknown');
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration < 0) return;
    const bucket = traceDrainRuntimeBuckets[metricName] || { totalMs: 0, count: 0, maxMs: 0 };
    bucket.totalMs += duration;
    bucket.count += 1;
    if (duration > bucket.maxMs) bucket.maxMs = duration;
    traceDrainRuntimeBuckets[metricName] = bucket;
  }

  function traceDrainWriteRuntimeProfile() {
    if (!isTracing || fd === null) return;
    const metricNames = Object.keys(traceDrainRuntimeBuckets).sort((a, b) => traceDrainRuntimeBuckets[b].totalMs - traceDrainRuntimeBuckets[a].totalMs);
    const metrics = {};
    for (let i = 0; i < metricNames.length; i++) {
      const name = metricNames[i];
      const bucket = traceDrainRuntimeBuckets[name];
      metrics[name] = {
        totalMs: Number(bucket.totalMs.toFixed(3)),
        count: bucket.count,
        avgMs: Number((bucket.totalMs / m.max(1, bucket.count)).toFixed(6)),
        maxMs: Number(bucket.maxMs.toFixed(6))
      };
    }
    const outDir = path.resolve(process.cwd(), 'metrics');
    fs.writeFileSync(path.join(outDir, 'play-runtime-profile.json'), JSON.stringify({
      generated: new Date().toISOString(),
      traced: true,
      metrics
    }, null, 2) + '\n');
  }

  function init() {
    if (!process.argv.includes('--trace')) return;
    isTracing = true;
    traceDrainRecordCount = 0;
    traceDrainPendingNotes = [];
    traceDrainResetRuntimeBuckets();

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
  function traceDrainFlush() {
    if (traceDrainBuffer.length === 0 || fd === null) return;
    fs.writeSync(fd, traceDrainBuffer.join(''));
    traceDrainBuffer.length = 0;
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
    traceDrainPendingNotes.push({ pitch, velocity, channel });
  }

  /**
   * Record one trace beat entry.
   * @param {string} layer
  * @param {{ beatKey: string, timeMs: number, conductorSnap: any, negotiation: any, trustScores: any, regime: any, couplingMatrix: any, phaseTelemetry?: any, couplingTargets?: any, axisCouplingTotals?: Record<string,number>, axisEnergyShare?: { shares: Record<string,number>, axisGini: number }, couplingGates?: { gateD: number, gateT: number, gateF: number, floorDampen: number, bypassD: number, bypassT: number, bypassF: number }, couplingHomeostasis?: any, axisEnergyEquilibrator?: any, transitionReadiness?: any, profilerTelemetry?: any, outputLoadGuard?: any, forcedTransitionEvent?: any, stageTiming?: Record<string,number>|null }} data
   */
  function record(layer, data) {
    if (!isTracing || fd === null) return;
    if (data.stageTiming) {
      const stageNames = Object.keys(data.stageTiming);
      for (let i = 0; i < stageNames.length; i++) {
        const stageName = stageNames[i];
        traceDrainRecordRuntimeMetric(`stage.${stageName}`, data.stageTiming[stageName]);
      }
    }
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
      notes: traceDrainPendingNotes.length > 0 ? traceDrainPendingNotes.slice() : undefined,
      stageTiming: data.stageTiming || undefined
    };
    // Clear accumulated notes after embedding
    traceDrainPendingNotes = [];

    traceDrainBuffer.push(JSON.stringify(payload) + '\n');
    traceDrainRecordCount++;
    if (traceDrainBuffer.length >= FLUSH_INTERVAL) traceDrainFlush();
  }

  // Mid-run diagnostic snapshot. Emitted periodically to capture
  // system state evolution beyond the beat-level trace window. The snapshot
  // includes key metrics that often diverge between early-run and end-of-run
  // (effectiveDim, trust scores, coupling means, gain multiplier, regime).
  let traceDrainSnapshotCount = 0;

  /**
   * Record a diagnostic snapshot (non-beat).
   * @param {{ beatKey: string, timeMs: number, effectiveDim: number, trustScores: any, trustVelocity?: Record<string,number>, couplingMeans: Record<string,number>, globalGainMultiplier: number, regime: string, couplingStrength: number, phaseIntegrity: string, activeProfile?: string, axisEnergyShare?: any, sectionKey?: string, sectionMode?: string }} data
   */
  function recordSnapshot(data) {
    if (!isTracing || fd === null) return;
    traceDrainSnapshotCount++;
    const payload = {
      recordType: 'snapshot',
      snapshotIndex: traceDrainSnapshotCount,
      beatKey: data.beatKey,
      timeMs: data.timeMs,
      effectiveDim: data.effectiveDim,
      trust: data.trustScores,
      trustVelocity: data.trustVelocity || null,
      activeProfile: data.activeProfile || 'unknown',
      couplingMeans: data.couplingMeans,
      globalGainMultiplier: data.globalGainMultiplier,
      regime: data.regime,
      couplingStrength: data.couplingStrength,
      phaseIntegrity: data.phaseIntegrity,
      // R8 E1: Forward axis energy shares for section-level phase tracking
      axisEnergyShare: data.axisEnergyShare || null,
      // R12 E1: section harmonic context for harmonicArc metric
      sectionKey: data.sectionKey || null,
      sectionMode: data.sectionMode || null
    };
    traceDrainBuffer.push(JSON.stringify(payload) + '\n');
    traceDrainRecordCount++;
    if (traceDrainBuffer.length >= FLUSH_INTERVAL) traceDrainFlush();
  }

  function shutdown() {
    traceDrainFlush();
    traceDrainWriteRuntimeProfile();
    if (isTracing && traceDrainRecordCount === 0) {
      throw new Error('traceDrain.shutdown: no trace entries were recorded during traced run');
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

  return { init, isEnabled, record, recordNote, recordSnapshot, recordRuntimeMetric: traceDrainRecordRuntimeMetric, flush: traceDrainFlush, shutdown };
})();
