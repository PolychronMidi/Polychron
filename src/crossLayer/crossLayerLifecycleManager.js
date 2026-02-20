CrossLayerLifecycleManager = (() => {
  function resetAll() {
    if (typeof ConvergenceDetector !== 'undefined' && ConvergenceDetector && typeof ConvergenceDetector.reset === 'function') ConvergenceDetector.reset();
    if (typeof RhythmicPhaseLock !== 'undefined' && RhythmicPhaseLock && typeof RhythmicPhaseLock.reset === 'function') RhythmicPhaseLock.reset();
    if (typeof SpectralComplementarity !== 'undefined' && SpectralComplementarity && typeof SpectralComplementarity.reset === 'function') SpectralComplementarity.reset();
    if (typeof MotifEcho !== 'undefined' && MotifEcho && typeof MotifEcho.reset === 'function') MotifEcho.reset();
    if (typeof MotifIdentityMemory !== 'undefined' && MotifIdentityMemory && typeof MotifIdentityMemory.reset === 'function') MotifIdentityMemory.reset();
    if (typeof InteractionHeatMap !== 'undefined' && InteractionHeatMap && typeof InteractionHeatMap.reset === 'function') InteractionHeatMap.reset();
    if (typeof EntropyRegulator !== 'undefined' && EntropyRegulator && typeof EntropyRegulator.reset === 'function') EntropyRegulator.reset();
    if (typeof EmergentDownbeat !== 'undefined' && EmergentDownbeat && typeof EmergentDownbeat.reset === 'function') EmergentDownbeat.reset();
    if (typeof ExplainabilityBus !== 'undefined' && ExplainabilityBus && typeof ExplainabilityBus.reset === 'function') ExplainabilityBus.reset();
    if (typeof AdaptiveTrustScores !== 'undefined' && AdaptiveTrustScores && typeof AdaptiveTrustScores.reset === 'function') AdaptiveTrustScores.reset();
    if (typeof SectionIntentCurves !== 'undefined' && SectionIntentCurves && typeof SectionIntentCurves.reset === 'function') SectionIntentCurves.reset();
    if (typeof PhaseAwareCadenceWindow !== 'undefined' && PhaseAwareCadenceWindow && typeof PhaseAwareCadenceWindow.reset === 'function') PhaseAwareCadenceWindow.reset();
    if (typeof NegotiationEngine !== 'undefined' && NegotiationEngine && typeof NegotiationEngine.reset === 'function') NegotiationEngine.reset();
    if (typeof GrooveTransfer !== 'undefined' && GrooveTransfer && typeof GrooveTransfer.reset === 'function') GrooveTransfer.reset();
    if (typeof RegisterCollisionAvoider !== 'undefined' && RegisterCollisionAvoider && typeof RegisterCollisionAvoider.reset === 'function') RegisterCollisionAvoider.reset();
    if (typeof AbsoluteTimeGrid !== 'undefined' && AbsoluteTimeGrid && typeof AbsoluteTimeGrid.reset === 'function') {
      AbsoluteTimeGrid.reset();
    }
  }

  function resetSection() {
    // Section boundary: clear short-memory interactions and telemetry windows.
    if (typeof PhaseAwareCadenceWindow !== 'undefined' && PhaseAwareCadenceWindow && typeof PhaseAwareCadenceWindow.reset === 'function') {
      PhaseAwareCadenceWindow.reset();
    }
    if (typeof InteractionHeatMap !== 'undefined' && InteractionHeatMap && typeof InteractionHeatMap.reset === 'function') {
      InteractionHeatMap.reset();
    }
    if (typeof EntropyRegulator !== 'undefined' && EntropyRegulator && typeof EntropyRegulator.reset === 'function') {
      EntropyRegulator.reset();
    }
    if (typeof ExplainabilityBus !== 'undefined' && ExplainabilityBus && typeof ExplainabilityBus.reset === 'function') {
      ExplainabilityBus.reset();
    }
    if (typeof AbsoluteTimeGrid !== 'undefined' && AbsoluteTimeGrid && typeof AbsoluteTimeGrid.reset === 'function') {
      AbsoluteTimeGrid.reset();
    }
  }

  function resetPhrase() {
    // Phrase boundary: clear motif/collision micro-memory and convergence pulses.
    if (typeof ConvergenceDetector !== 'undefined' && ConvergenceDetector && typeof ConvergenceDetector.reset === 'function') {
      ConvergenceDetector.reset();
    }
    if (typeof MotifEcho !== 'undefined' && MotifEcho && typeof MotifEcho.reset === 'function') {
      MotifEcho.reset();
    }
    if (typeof MotifIdentityMemory !== 'undefined' && MotifIdentityMemory && typeof MotifIdentityMemory.reset === 'function') {
      MotifIdentityMemory.reset();
    }
    if (typeof RegisterCollisionAvoider !== 'undefined' && RegisterCollisionAvoider && typeof RegisterCollisionAvoider.reset === 'function') {
      RegisterCollisionAvoider.reset();
    }
    if (typeof GrooveTransfer !== 'undefined' && GrooveTransfer && typeof GrooveTransfer.reset === 'function') {
      GrooveTransfer.reset();
    }
  }

  return { resetAll, resetSection, resetPhrase };
})();
