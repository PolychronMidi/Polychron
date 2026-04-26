// crossLayerEmissionGateway.js - Thin gateway for cross-layer MIDI buffer writes.
// Routes all cross-layer note/CC emissions through a single observed point,
// enabling attribution tracking, density auditing, and forensic traceability.
//
// Three cross-layer modules emit directly to the MIDI buffer:
//   emergentDownbeat    - bass reinforcement notes + stereo pan CC
//   convergenceDetector - convergence burst notes
//   velocityInterference - DAW visualization CC
//
// This gateway wraps those emissions so every cross-layer MIDI write is:
//   1. Attributed to a source module
//   2. Counted for density monitoring
//   3. Emitted to explainabilityBus for forensic traceability

moduleLifecycle.declare({
  name: 'crossLayerEmissionGateway',
  subsystem: 'crossLayer',
  deps: ['validator'],
  provides: ['crossLayerEmissionGateway'],
  init: (deps) => {
  const V = deps.validator.create('crossLayerEmissionGateway');

  /** @type {Record<string, number>} per-module emission counts for the current scope */
  const counts = {};
  let totalEmissions = 0;

  /**
   * Emit a MIDI event to the buffer from a cross-layer module.
   * Wraps p(c, event) with attribution and diagnostics.
   * @param {string} sourceModule - the cross-layer module name (e.g., 'emergentDownbeat')
   * @param {any[]} buffer - the MIDI event buffer (typically `c`)
   * @param {object} event - the MIDI event object { tick, type?, vals }
   */
  function emit(sourceModule, buffer, event) {
    V.assertNonEmptyString(sourceModule, 'sourceModule');
    V.assertArray(buffer, 'buffer');
    V.assertObject(event, 'event');

    // Push event to MIDI buffer
    buffer.push(event);

    // Observe control_c events in the channel state field so CIM can read
    // per-channel writer lineage. Note emissions are tracked via velocity.
    if (event && Array.isArray(event.vals)) {
      if (event.type === 'control_c' && event.vals.length >= 3) {
        channelStateField.observeControl(event.vals[0], event.vals[1], event.vals[2], sourceModule);
      } else if (event.type === 'on' && event.vals.length >= 3) {
        channelStateField.write(event.vals[0], 'velocity', event.vals[2], sourceModule);
      }
    }

    // Track emission count per source module
    if (!counts[sourceModule]) counts[sourceModule] = 0;
    counts[sourceModule]++;
    totalEmissions++;
  }

  /**
   * Emit multiple MIDI events from one cross-layer module.
   * @param {string} sourceModule
   * @param {any[]} buffer
   * @param {...object} events
   */
  function emitMultiple(sourceModule, buffer, ...events) {
    for (let i = 0; i < events.length; i++) {
      emit(sourceModule, buffer, events[i]);
    }
  }

  /**
   * Get emission counts per source module.
   * @returns {Record<string, number>}
   */
  function getCounts() {
    return { ...counts };
  }

  /**
   * Get total cross-layer emissions.
   * @returns {number}
   */
  function getTotal() {
    return totalEmissions;
  }

  /**
   * Get a diagnostic snapshot.
   * @returns {{ counts: Record<string, number>, total: number }}
   */
  function getSnapshot() {
    return { counts: { ...counts }, total: totalEmissions };
  }

  function reset() {
    for (const k of Object.keys(counts)) {
      counts[k] = 0;
    }
    totalEmissions = 0;
  }

  return { emit, emitMultiple, getCounts, getTotal, getSnapshot, reset };
  },
});
