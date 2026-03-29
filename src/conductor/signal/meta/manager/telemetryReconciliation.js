// telemetryReconciliation.js -- hypermeta telemetry reconciliation.
// Tracks gaps between trace P95 and controller P95, applies trust
// velocity damping, and checks phase telemetry integrity.

hyperMetaManagerTelemetry = (() => {
  const V = validator.create('telemetryReconciliation');
  const ST = hyperMetaManagerState;
  const S  = ST.S;

  /**
   * Update telemetry reconciliation gaps from trace summary and controller state.
   * When gaps are large, accelerate controller alpha to track reality faster.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function updateReconciliation(state) {
    const traceSummary = safePreBoot.call(() => traceSummaryData, null);
    if (!traceSummary || !traceSummary.adaptiveTelemetryReconciliation) return;

    const reconciliation = traceSummary.adaptiveTelemetryReconciliation;
    const pairs = Object.keys(reconciliation.pairs || {});

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const traceData = reconciliation.pairs[pair];
      const controllerData = state.pairCeiling && state.pairCeiling[pair];
      if (!traceData || !controllerData) continue;

      const gap = traceData.traceP95 - controllerData.p95Ema;
      ST.reconciliationGaps[pair] = {
        traceP95: traceData.traceP95,
        controllerP95: controllerData.p95Ema,
        gap,
      };

      if (gap > 0.20 && controllerData.activeBeats > 30) {
        ST.rateMultipliers.p95Alpha = m.max(ST.rateMultipliers.p95Alpha, 2.0);
      }
    }
  }

  /**
   * Apply trust velocity damping to stabilize system.
   * When attenuation velocity is high, dampen global rate.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function applyTrustVelocityDamping(state) {
    if (!state.watchdog) return;

    const pipelines = Object.keys(state.watchdog);
    for (let i = 0; i < pipelines.length; i++) {
      const pipeline = pipelines[i];
      const controllers = Object.keys(state.watchdog[pipeline]);

      for (let j = 0; j < controllers.length; j++) {
        const controller = controllers[j];
        const currentAttenuation = state.watchdog[pipeline][controller];
        const key = pipeline + '-' + controller;

        if (!ST.trustVelocityHistory[key]) ST.trustVelocityHistory[key] = [];

        ST.trustVelocityHistory[key].push(currentAttenuation);
        if (ST.trustVelocityHistory[key].length > 5) ST.trustVelocityHistory[key].shift();

        const history = ST.trustVelocityHistory[key];
        if (history.length >= 3) {
          const velocity = (history[history.length - 1] - history[history.length - 3]) / 2;
          if (m.abs(velocity) > 0.15) {
            ST.rateMultipliers.global *= ST.TRUST_VELOCITY_DAMPING;
          }
        }
      }
    }
  }

  /**
   * Check phase telemetry integrity and apply corrections when stale.
   * @param {ReturnType<typeof hyperMetaManagerHealth.gatherControllerState>} state
   */
  function checkPhaseTelemetryIntegrity(state) {
    const telemetryHealth = safePreBoot.call(() => telemetryHealthData, null);
    if (!telemetryHealth) return;

    const staleRate = V.optionalFinite(telemetryHealth.phaseStaleRate, 0);

    if (staleRate > ST.PHASE_STALE_THRESHOLD) {
      // Stale: boost phase sensitivity, relax gates, increase creativity
      if (state.phaseFloor) {
        S.phaseBoostCeiling = clamp(S.phaseBoostCeiling + 1.0, 25.0, 40.0);
      }
      // Write to dedicated telemetry key so it doesn't overwrite the
      // phase-share-derived value from updateRateMultipliers.
      // The public getter takes max(varianceGateRelax, varianceGateRelaxTelemetry).
      ST.rateMultipliers.varianceGateRelaxTelemetry = m.max(
        ST.rateMultipliers.varianceGateRelaxTelemetry, 1.8);
      S.topologyCreativityMultiplier = m.max(S.topologyCreativityMultiplier, 1.15);
    } else {
      // Healthy: decay telemetry-side relaxation independently
      S.phaseBoostCeiling = clamp(S.phaseBoostCeiling - 0.2, 25.0, 40.0);
      ST.rateMultipliers.varianceGateRelaxTelemetry = m.max(
        1.0, (ST.rateMultipliers.varianceGateRelaxTelemetry) * 0.95);
    }
  }

  return {
    updateReconciliation,
    applyTrustVelocityDamping,
    checkPhaseTelemetryIntegrity,
  };
})();
