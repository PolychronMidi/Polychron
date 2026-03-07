# Conductor Intelligence Map

> Auto-generated per run by `generate-conductor-map.js`. Do not edit by hand.
> Generated: 2026-03-06T23:40:14.682Z

## Summary

| Domain | Modules | Density | Tension | Flicker | Recorders | State Providers |
|---|---|---|---|---|---|---|
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
- **Bias values (end-of-run):** density=1.0000, tension=1.0000

#### `densityWaveAnalyzer`

- **File:** `src/conductor/dynamics/densityWaveAnalyzer.js`
- **Registrations:** flicker, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9603

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
- **Bias values (end-of-run):** tension=0.9000

#### `dynamicPeakMemory`

- **File:** `src/conductor/dynamics/dynamicPeakMemory.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=0.9200

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
- **Bias values (end-of-run):** flicker=1.1200

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
- **Bias values (end-of-run):** tension=1.1377

#### `harmonicDensityOscillator`

- **File:** `src/conductor/harmonic/harmonicDensityOscillator.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0000

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
- **Bias values (end-of-run):** tension=1.0250

#### `harmonicRhythmDensityRatio`

- **File:** `src/conductor/harmonic/harmonicRhythmDensityRatio.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `harmonicSurpriseIndex`

- **File:** `src/conductor/harmonic/harmonicSurpriseIndex.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=0.9645

#### `harmonicVelocityMonitor`

- **File:** `src/conductor/harmonic/harmonicVelocityMonitor.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** conductorState
- **Bias values (end-of-run):** tension=1.0700

#### `tensionResolutionTracker`

- **File:** `src/conductor/harmonic/tensionResolutionTracker.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0366

#### `tonalAnchorDistanceTracker`

- **File:** `src/conductor/harmonic/tonalAnchorDistanceTracker.js`
- **Registrations:** tension, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0133

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
- **Bias values (end-of-run):** density=0.9432

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
- **Bias values (end-of-run):** flicker=0.9481

#### `tessituraPressureMonitor`

- **File:** `src/conductor/melodic/tessituraPressureMonitor.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9370

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
- **Bias values (end-of-run):** density=1.0400

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
- **Bias values (end-of-run):** flicker=1.0038

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
- **Bias values (end-of-run):** density=0.9300

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
- **Bias values (end-of-run):** density=1.1800

#### `rhythmicDensityContrastTracker`

- **File:** `src/conductor/rhythmic/rhythmicDensityContrastTracker.js`
- **Registrations:** flicker, recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=1.0123

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

- **File:** `src/conductor/signal/axisEnergyEquilibrator.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus

#### `coherenceMonitor`

- **File:** `src/conductor/signal/coherenceMonitor.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, densityAttribution, timeStream
- **Bias values (end-of-run):** density=1.0256

#### `conductorMetaWatchdog`

- **File:** `src/conductor/signal/conductorMetaWatchdog.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus

#### `couplingHomeostasis`

- **File:** `src/conductor/signal/couplingHomeostasis.js`
- **Registrations:** recorder
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, systemDynamics

#### `criticalityEngine`

- **File:** `src/conductor/signal/criticalityEngine.js`
- **Registrations:** density, tension, flicker, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** conductorState, density, explainabilityBus, flicker, signalHealth, tension
- **Bias values (end-of-run):** density=0.9200, tension=0.9200, flicker=0.9200

#### `dimensionalityExpander`

- **File:** `src/conductor/signal/dimensionalityExpander.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** all, section
- **Signal reads:** explainabilityBus, systemDynamics
- **Bias values (end-of-run):** density=1.0000, tension=0.9804, flicker=1.0000

#### `narrativeTrajectory`

- **File:** `src/conductor/signal/narrativeTrajectory.js`
- **Registrations:** tension, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** density, flicker, tension, timeStream
- **Bias values (end-of-run):** tension=1.0800

#### `pipelineBalancer`

- **File:** `src/conductor/signal/pipelineBalancer.js`
- **Registrations:** density, tension, recorder
- **Reset scopes:** section
- **Signal reads:** density, densityAttribution, tension
- **Bias values (end-of-run):** density=1.0295, tension=1.0000

#### `pipelineCouplingManager`

- **File:** `src/conductor/signal/pipelineCouplingManager.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, signalHealth, systemDynamics, trust
- **Bias values (end-of-run):** density=1.1065, tension=1.0370, flicker=0.9801

#### `pipelineNormalizer`

- **File:** `src/conductor/signal/pipelineNormalizer.js`
- **Registrations:** none
- **Reset scopes:** all
- **Signal reads:** none detected

#### `profileAdaptation`

- **File:** `src/conductor/signal/profileAdaptation.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, flicker, signalTelemetry, tension

#### `regimeReactiveDamping`

- **File:** `src/conductor/signal/regimeReactiveDamping.js`
- **Registrations:** density, tension, flicker, recorder
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, systemDynamics
- **Bias values (end-of-run):** density=1.0000, tension=1.0277, flicker=1.0694

#### `signalHealthAnalyzer`

- **File:** `src/conductor/signal/signalHealthAnalyzer.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** explainabilityBus, signalHealth, trust

#### `signalTelemetry`

- **File:** `src/conductor/signal/signalTelemetry.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** density, flicker, signalTelemetry, tension

#### `structuralNarrativeAdvisor`

- **File:** `src/conductor/signal/structuralNarrativeAdvisor.js`
- **Registrations:** density, recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** conductorState
- **Bias values (end-of-run):** density=1.0362

#### `systemDynamicsProfiler`

- **File:** `src/conductor/signal/systemDynamicsProfiler.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** all
- **Signal reads:** entropy, explainabilityBus, systemDynamics, timeStream, trust

### Texture

#### `composerFeedbackAdvisor`

- **File:** `src/conductor/texture/composerFeedbackAdvisor.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `crossLayerDensityBalancer`

- **File:** `src/conductor/texture/crossLayerDensityBalancer.js`
- **Registrations:** density, stateProvider
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `layerCoherenceScorer`

- **File:** `src/conductor/texture/layerCoherenceScorer.js`
- **Registrations:** density, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9250

#### `layerEntryExitTracker`

- **File:** `src/conductor/texture/layerEntryExitTracker.js`
- **Registrations:** recorder, stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `layerIndependenceScorer`

- **File:** `src/conductor/texture/layerIndependenceScorer.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `motivicDensityTracker`

- **File:** `src/conductor/texture/motivicDensityTracker.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=1.0000

#### `phraseLengthMomentumTracker`

- **File:** `src/conductor/texture/phraseLengthMomentumTracker.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `repetitionFatigueMonitor`

- **File:** `src/conductor/texture/repetitionFatigueMonitor.js`
- **Registrations:** tension
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** tension=1.0812

#### `restDensityTracker`

- **File:** `src/conductor/texture/restDensityTracker.js`
- **Registrations:** density
- **Reset scopes:** none detected
- **Signal reads:** none detected
- **Bias values (end-of-run):** density=0.9000

#### `sectionLengthAdvisor`

- **File:** `src/conductor/texture/sectionLengthAdvisor.js`
- **Registrations:** recorder
- **Reset scopes:** section
- **Signal reads:** none detected

#### `structuralFormTracker`

- **File:** `src/conductor/texture/structuralFormTracker.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** timeStream

#### `texturalGradientTracker`

- **File:** `src/conductor/texture/texturalGradientTracker.js`
- **Registrations:** flicker, recorder
- **Reset scopes:** section
- **Signal reads:** none detected
- **Bias values (end-of-run):** flicker=0.9779

#### `texturalMemoryAdvisor`

- **File:** `src/conductor/texture/texturalMemoryAdvisor.js`
- **Registrations:** stateProvider
- **Reset scopes:** section
- **Signal reads:** none detected

#### `voiceDensityBalancer`

- **File:** `src/conductor/texture/voiceDensityBalancer.js`
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
- **Bias values (end-of-run):** flicker=0.9232
