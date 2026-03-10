# Conductor Intelligence Map

> Auto-generated per run by `generate-conductor-map.js`. Do not edit by hand.
> Generated: 2026-03-10T14:27:26.616Z

## Summary

| Domain | Modules | Density | Tension | Flicker | Recorders | State Providers |
||||||||
| dynamics | 8 | 2 | 3 | 4 | 5 | 4 |
| harmonic | 13 | 3 | 9 | 0 | 3 | 7 |
| journey | 1 | 0 | 0 | 0 | 0 | 0 |
| melodic | 9 | 6 | 1 | 1 | 3 | 8 |
| rhythmic | 10 | 6 | 0 | 3 | 2 | 7 |
| signal | 16 | 7 | 6 | 4 | 14 | 10 |
| texture | 14 | 6 | 1 | 1 | 4 | 6 |
| top-level | 1 | 0 | 0 | 0 | 0 | 0 |
| unknown | 2 | 0 | 0 | 0 | 0 | 0 |

## Module Details

### Dynamics

#### `climaxProximityPredictor`

- **File:** `src/conductor/dynamics/climaxProximityPredictor.js`
- **Registrations:** density, tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.8800, tension=1.0000

#### `densityWaveAnalyzer`

- **File:** `src/conductor/dynamics/densityWaveAnalyzer.js`
- **Registrations:** flicker, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0000

#### `durationalContourTracker`

- **File:** `src/conductor/dynamics/durationalContourTracker.js`
- **Registrations:** flicker, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0000

#### `dynamicArchitectPlanner`

- **File:** `src/conductor/dynamics/dynamicArchitectPlanner.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0485

#### `dynamicPeakMemory`

- **File:** `src/conductor/dynamics/dynamicPeakMemory.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=0.9801

#### `dynamicRangeTracker`

- **File:** `src/conductor/dynamics/dynamicRangeTracker.js`
- **Registrations:** flicker, recorder
- **Reset scopes:** section
- **Signal reads:** none detected

#### `energyMomentumTracker`

- **File:** `src/conductor/dynamics/energyMomentumTracker.js`
- **Registrations:** density, recorder
- **Reset scopes:** section
- **Signal reads:** tension
- **Bias values (end-of-run):** density=1.0000

#### `velocityShapeAnalyzer`

- **File:** `src/conductor/dynamics/velocityShapeAnalyzer.js`
- **Registrations:** flicker, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0511

### Harmonic

#### `cadenceAdvisor`

- **File:** `src/conductor/harmonic/cadenceAdvisor.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `cadentialPreparationAdvisor`

- **File:** `src/conductor/harmonic/cadentialPreparationAdvisor.js`
- **Registrations:** tension, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0000

#### `chromaticSaturationMonitor`

- **File:** `src/conductor/harmonic/chromaticSaturationMonitor.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `consonanceDissonanceTracker`

- **File:** `src/conductor/harmonic/consonanceDissonanceTracker.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.1410

#### `harmonicDensityOscillator`

- **File:** `src/conductor/harmonic/harmonicDensityOscillator.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0800

#### `harmonicFieldDensityTracker`

- **File:** `src/conductor/harmonic/harmonicFieldDensityTracker.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9400

#### `harmonicFunctionGraph`

- **File:** `src/conductor/harmonic/harmonicFunctionGraph.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** absoluteTimeGrid, conductorState
- **Bias values (end-of-run):** tension=1.0200

#### `harmonicPedalFieldTracker`

- **File:** `src/conductor/harmonic/harmonicPedalFieldTracker.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=0.9531

#### `harmonicRhythmDensityRatio`

- **File:** `src/conductor/harmonic/harmonicRhythmDensityRatio.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.8800

#### `harmonicSurpriseIndex`

- **File:** `src/conductor/harmonic/harmonicSurpriseIndex.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=0.9707

#### `harmonicVelocityMonitor`

- **File:** `src/conductor/harmonic/harmonicVelocityMonitor.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** conductorState
- **Bias values (end-of-run):** tension=0.8800

#### `tensionResolutionTracker`

- **File:** `src/conductor/harmonic/tensionResolutionTracker.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0583

#### `tonalAnchorDistanceTracker`

- **File:** `src/conductor/harmonic/tonalAnchorDistanceTracker.js`
- **Registrations:** tension, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0567

### Journey

#### `harmonicRhythmTracker`

- **File:** `src/conductor/journey/harmonicRhythmTracker.js`
- **Registrations:** none
- **Reset scopes:** section
- **Signal reads:** none detected

### Melodic

#### `ambitusMigrationTracker`

- **File:** `src/conductor/melodic/ambitusMigrationTracker.js`
- **Registrations:** density, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9400

#### `counterpointMotionTracker`

- **File:** `src/conductor/melodic/counterpointMotionTracker.js`
- **Registrations:** tension, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0000

#### `intervalBalanceTracker`

- **File:** `src/conductor/melodic/intervalBalanceTracker.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9353

#### `intervalExpansionContractor`

- **File:** `src/conductor/melodic/intervalExpansionContractor.js`
- **Registrations:** density, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9600

#### `melodicContourTracker`

- **File:** `src/conductor/melodic/melodicContourTracker.js`
- **Registrations:** density, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0200

#### `registralVelocityCorrelator`

- **File:** `src/conductor/melodic/registralVelocityCorrelator.js`
- **Registrations:** flicker
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9441

#### `tessituraPressureMonitor`

- **File:** `src/conductor/melodic/tessituraPressureMonitor.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9400

#### `thematicRecallDetector`

- **File:** `src/conductor/melodic/thematicRecallDetector.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `voiceLeadingEfficiencyTracker`

- **File:** `src/conductor/melodic/voiceLeadingEfficiencyTracker.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

### Rhythmic

#### `attackDensityProfiler`

- **File:** `src/conductor/rhythmic/attackDensityProfiler.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0500

#### `grooveTemplateAdvisor`

- **File:** `src/conductor/rhythmic/grooveTemplateAdvisor.js`
- **Registrations:** flicker
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0008

#### `interLayerRhythmAnalyzer`

- **File:** `src/conductor/rhythmic/interLayerRhythmAnalyzer.js`
- **Registrations:** flicker, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9500

#### `onsetDensityProfiler`

- **File:** `src/conductor/rhythmic/onsetDensityProfiler.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** density
- **Bias values (end-of-run):** density=1.0000

#### `onsetRegularityMonitor`

- **File:** `src/conductor/rhythmic/onsetRegularityMonitor.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9200

#### `rhythmicComplexityGradient`

- **File:** `src/conductor/rhythmic/rhythmicComplexityGradient.js`
- **Registrations:** density, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `rhythmicDensityContrastTracker`

- **File:** `src/conductor/rhythmic/rhythmicDensityContrastTracker.js`
- **Registrations:** flicker, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0613

#### `rhythmicInertiaTracker`

- **File:** `src/conductor/rhythmic/rhythmicInertiaTracker.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** section
- **Signal reads:** flicker
- **Bias values (end-of-run):** density=1.0000

#### `syncopationDensityTracker`

- **File:** `src/conductor/rhythmic/syncopationDensityTracker.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.8800

#### `temporalProportionTracker`

- **File:** `src/conductor/rhythmic/temporalProportionTracker.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

### Signal

#### `axisEnergyEquilibrator`

- **File:** `src/conductor/signal/balancing/axisEnergyEquilibrator.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus

#### `coherenceMonitor`

- **File:** `src/conductor/signal/foundations/coherenceMonitor.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, densityAttribution, timeStream
- **Bias values (end-of-run):** density=1.0000

#### `conductorMetaWatchdog`

- **File:** `src/conductor/signal/meta/conductorMetaWatchdog.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus

#### `couplingHomeostasis`

- **File:** `src/conductor/signal/balancing/coupling/homeostasis/couplingHomeostasis.js`
- **Registrations:** recorder
- **Reset scopes:** section
- **Signal reads:** none detected

#### `criticalityEngine`

- **File:** `src/conductor/signal/meta/criticalityEngine.js`
- **Registrations:** density, tension, flicker, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** conductorState, density, explainabilityBus, flicker, signalHealth, tension
- **Bias values (end-of-run):** density=1.0000, tension=1.0000, flicker=1.0000

#### `dimensionalityExpander`

- **File:** `src/conductor/signal/meta/dimensionalityExpander.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** all, section
- **Signal reads:** explainabilityBus, systemDynamics
- **Bias values (end-of-run):** density=1.0000, tension=0.9989, flicker=1.0000

#### `narrativeTrajectory`

- **File:** `src/conductor/signal/narrative/narrativeTrajectory.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** density, flicker, tension, timeStream
- **Bias values (end-of-run):** tension=1.0800

#### `pipelineBalancer`

- **File:** `src/conductor/signal/balancing/coupling/pipelineBalancer.js`
- **Registrations:** density, tension, recorder
- **Reset scopes:** section
- **Signal reads:** density, densityAttribution, tension
- **Bias values (end-of-run):** density=1.0575, tension=1.0000

#### `pipelineCouplingManager`

- **File:** `src/conductor/signal/balancing/coupling/pipelineCouplingManager.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, systemDynamics
- **Bias values (end-of-run):** density=0.8450, tension=0.8400, flicker=0.7620

#### `pipelineNormalizer`

- **File:** `src/conductor/signal/foundations/pipelineNormalizer.js`
- **Registrations:** none
- **Reset scopes:** all
- **Signal reads:** none detected

#### `profileAdaptation`

- **File:** `src/conductor/signal/foundations/profileAdaptation.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, flicker, signalTelemetry, tension

#### `regimeReactiveDamping`

- **File:** `src/conductor/signal/profiling/regimeReactiveDamping.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, systemDynamics
- **Bias values (end-of-run):** density=0.9672, tension=1.1800, flicker=0.8800

#### `signalHealthAnalyzer`

- **File:** `src/conductor/signal/foundations/signalHealthAnalyzer.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, signalHealth, trust

#### `signalTelemetry`

- **File:** `src/conductor/signal/foundations/signalTelemetry.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, flicker, signalTelemetry, tension

#### `structuralNarrativeAdvisor`

- **File:** `src/conductor/signal/narrative/structuralNarrativeAdvisor.js`
- **Registrations:** density, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** conductorState
- **Bias values (end-of-run):** density=1.0388

#### `systemDynamicsProfiler`

- **File:** `src/conductor/signal/profiling/systemDynamicsProfiler.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** systemDynamics

### Texture

#### `composerFeedbackAdvisor`

- **File:** `src/conductor/texture/form/composerFeedbackAdvisor.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `crossLayerDensityBalancer`

- **File:** `src/conductor/texture/layers/crossLayerDensityBalancer.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9400

#### `layerCoherenceScorer`

- **File:** `src/conductor/texture/layers/layerCoherenceScorer.js`
- **Registrations:** density, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9250

#### `layerEntryExitTracker`

- **File:** `src/conductor/texture/layers/layerEntryExitTracker.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `layerIndependenceScorer`

- **File:** `src/conductor/texture/layers/layerIndependenceScorer.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `motivicDensityTracker`

- **File:** `src/conductor/texture/phrasing/motivicDensityTracker.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `phraseLengthMomentumTracker`

- **File:** `src/conductor/texture/phrasing/phraseLengthMomentumTracker.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `repetitionFatigueMonitor`

- **File:** `src/conductor/texture/phrasing/repetitionFatigueMonitor.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0846

#### `restDensityTracker`

- **File:** `src/conductor/texture/form/restDensityTracker.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9000

#### `sectionLengthAdvisor`

- **File:** `src/conductor/texture/form/sectionLengthAdvisor.js`
- **Registrations:** recorder
- **Reset scopes:** section
- **Signal reads:** none detected

#### `structuralFormTracker`

- **File:** `src/conductor/texture/form/structuralFormTracker.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** timeStream

#### `texturalGradientTracker`

- **File:** `src/conductor/texture/form/texturalGradientTracker.js`
- **Registrations:** flicker, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9633

#### `texturalMemoryAdvisor`

- **File:** `src/conductor/texture/form/texturalMemoryAdvisor.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `voiceDensityBalancer`

- **File:** `src/conductor/texture/balance/voiceDensityBalancer.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9000

### Top-level

#### `conductorState`

- **File:** `src/conductor/conductorState.js`
- **Registrations:** none
- **Reset scopes:** section
- **Signal reads:** conductorState

### Unknown

#### `dynamicRangeTracker:contrast`

- **Registrations:** none
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0000

#### `dynamicRangeTracker:spread`

- **Registrations:** none
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9312
