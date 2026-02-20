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
    if (typeof HarmonicIntervalGuard !== 'undefined' && HarmonicIntervalGuard && typeof HarmonicIntervalGuard.reset === 'function') HarmonicIntervalGuard.reset();
    if (typeof RestSynchronizer !== 'undefined' && RestSynchronizer && typeof RestSynchronizer.reset === 'function') RestSynchronizer.reset();
    if (typeof CrossLayerClimaxEngine !== 'undefined' && CrossLayerClimaxEngine && typeof CrossLayerClimaxEngine.reset === 'function') CrossLayerClimaxEngine.reset();
    if (typeof RhythmicComplementEngine !== 'undefined' && RhythmicComplementEngine && typeof RhythmicComplementEngine.reset === 'function') RhythmicComplementEngine.reset();
    // PitchMemoryRecall intentionally NOT reset — long-term thematic memory
    if (typeof ArticulationComplement !== 'undefined' && ArticulationComplement && typeof ArticulationComplement.reset === 'function') ArticulationComplement.reset();
    if (typeof CrossLayerDynamicEnvelope !== 'undefined' && CrossLayerDynamicEnvelope && typeof CrossLayerDynamicEnvelope.reset === 'function') CrossLayerDynamicEnvelope.reset();
    if (typeof ConvergenceHarmonicTrigger !== 'undefined' && ConvergenceHarmonicTrigger && typeof ConvergenceHarmonicTrigger.reset === 'function') ConvergenceHarmonicTrigger.reset();
    if (typeof TexturalMirror !== 'undefined' && TexturalMirror && typeof TexturalMirror.reset === 'function') TexturalMirror.reset();
    if (typeof CrossLayerSilhouette !== 'undefined' && CrossLayerSilhouette && typeof CrossLayerSilhouette.reset === 'function') CrossLayerSilhouette.reset();
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
    if (typeof HarmonicIntervalGuard !== 'undefined' && HarmonicIntervalGuard && typeof HarmonicIntervalGuard.reset === 'function') HarmonicIntervalGuard.reset();
    if (typeof RestSynchronizer !== 'undefined' && RestSynchronizer && typeof RestSynchronizer.reset === 'function') RestSynchronizer.reset();
    if (typeof CrossLayerClimaxEngine !== 'undefined' && CrossLayerClimaxEngine && typeof CrossLayerClimaxEngine.reset === 'function') CrossLayerClimaxEngine.reset();
    // PitchMemoryRecall NOT reset at section boundaries
    if (typeof ArticulationComplement !== 'undefined' && ArticulationComplement && typeof ArticulationComplement.reset === 'function') ArticulationComplement.reset();
    if (typeof CrossLayerDynamicEnvelope !== 'undefined' && CrossLayerDynamicEnvelope && typeof CrossLayerDynamicEnvelope.reset === 'function') CrossLayerDynamicEnvelope.reset();
    if (typeof ConvergenceHarmonicTrigger !== 'undefined' && ConvergenceHarmonicTrigger && typeof ConvergenceHarmonicTrigger.reset === 'function') ConvergenceHarmonicTrigger.reset();
    if (typeof TexturalMirror !== 'undefined' && TexturalMirror && typeof TexturalMirror.reset === 'function') TexturalMirror.reset();
    if (typeof CrossLayerSilhouette !== 'undefined' && CrossLayerSilhouette && typeof CrossLayerSilhouette.reset === 'function') CrossLayerSilhouette.reset();
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
    if (typeof RhythmicComplementEngine !== 'undefined' && RhythmicComplementEngine && typeof RhythmicComplementEngine.reset === 'function') RhythmicComplementEngine.reset();
  }

  return { resetAll, resetSection, resetPhrase };
})();
