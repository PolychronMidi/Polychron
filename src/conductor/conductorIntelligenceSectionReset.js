// conductorIntelligenceSectionReset.js — Centralized section-boundary reset
// for all conductor intelligence modules that expose reset().
// Without this, internal ring buffers, counters, and trend accumulators
// bleed across sections, corrupting early-section signal readings.

const V = Validator.create('conductorIntelligenceSectionReset');

let initialized = false;

/** All intelligence modules that expose reset() but lack their own SECTION_BOUNDARY subscription. */
function resetAll() {
  // dynamics
  EnergyMomentumTracker.reset();
  DynamicRangeTracker.reset();
  DynamicPeakMemory.reset();
  DynamicArchitectPlanner.reset();
  DensityWaveAnalyzer.reset();
  // harmonic
  TonalAnchorDistanceTracker.reset();
  HarmonicPedalFieldTracker.reset();
  HarmonicDensityOscillator.reset();
  CadenceAdvisor.reset();
  // melodic
  ThematicRecallDetector.reset();
  MelodicContourTracker.reset();
  IntervalExpansionContractor.reset();
  AmbitusMigrationTracker.reset();
  // rhythmic
  TemporalProportionTracker.reset();
  RhythmicInertiaTracker.reset();
  RhythmicDensityContrastTracker.reset();
  RhythmicComplexityGradient.reset();
  // texture
  TexturalMemoryAdvisor.reset();
  TexturalGradientTracker.reset();
  StructuralFormTracker.reset();
  SectionLengthAdvisor.reset();
  PhraseLengthMomentumTracker.reset();
  LayerEntryExitTracker.reset();
  LayerCoherenceScorer.reset();
}

function initialize() {
  if (initialized) return;
  initialized = true;
  const EVENTS = V.getEventsOrThrow();
  EventBus.on(EVENTS.SECTION_BOUNDARY, resetAll);
}

conductorIntelligenceSectionReset = { initialize, resetAll };
