#!/usr/bin/env node
// scripts/fix-pascal-globals.js
// Renames PascalCase non-class global identifiers to camelCase across the codebase.
//
// DRY RUN by default: shows what would change without writing.
// Run with --apply to write changes:
//   node scripts/fix-pascal-globals.js --apply
//
// File renames are NEVER performed — only git mv commands are printed.
// Run the printed git mv commands yourself after verifying dry-run output.

'use strict';

const fs   = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ROOT  = path.resolve(__dirname, '..');
const SELF  = path.resolve(__filename);

// ── Identifier rename map (PascalCase → camelCase) ──────────────────────────
// Sorted longest-first in the replacement loop to prevent partial matches.
// Each key is the EXACT global identifier to rename.
//
// Includes both batch-2 (new) and batch-1 (already-renamed-in-most-files)
// identifiers. Batch-1 entries are no-ops in files where the rename already
// happened — they only catch files missed by the previous run.

const RENAMES = {
  // ── composers/chord ──
  'ChordRegistry':                   'chordRegistry',
  'ChordValues':                     'chordValues',
  'PivotChordBridge':                'pivotChordBridge',

  // ── composers (root) ──
  'IntervalComposer':                'intervalComposer',
  'MeasureNotePool':                 'measureNotePool',

  // ── composers/factory ──
  'ComposerFactory':                 'FactoryManager',
  'FactoryManager':                  'FactoryManager',

  // ── composers/motif ──
  'CandidateExpansion':              'candidateExpansion',
  'MotifChain':                      'motifChain',
  'MotifManager':                    'motifManager',
  'MotifRegistry':                   'motifRegistry',
  'MotifSpreader':                   'motifSpreader',
  'MotifTransformAdvisor':           'motifTransformAdvisor',
  'MotifTransforms':                 'motifTransforms',
  'MotifValidators':                 'motifValidators',
  'MotifValues':                     'motifValues',

  // ── composers/profiles ──
  'ComposerProfileUtils':            'composerProfileUtils',
  'ComposerProfileValidation':       'composerProfileValidation',
  'ComposerRuntimeProfileAdapter':   'composerRuntimeProfileAdapter',

  // ── composers/voice ──
  'RegisterBiasing':                 'registerBiasing',
  'VoiceLeadingCore':                'voiceLeadingCore',
  'VoiceLeadingScorers':             'voiceLeadingScorers',
  'VoiceRegistry':                   'voiceRegistry',
  'VoiceValues':                     'voiceValues',

  // ── conductor (root) ──
  'ConductorConfig':                 'conductorConfig',
  'ConductorIntelligence':           'conductorIntelligence',
  'ConductorState':                  'conductorState',
  'DynamismEngine':                  'dynamismEngine',
  'GlobalConductor':                 'globalConductor',
  'GlobalConductorUpdate':           'globalConductorUpdate',
  'HarmonicContext':                 'harmonicContext',
  'HarmonicJourney':                 'harmonicJourney',
  'HarmonicRhythmTracker':           'harmonicRhythmTracker',
  'TextureBlender':                  'textureBlender',

  // ── conductor/dynamics ──
  'ClimaxProximityPredictor':        'climaxProximityPredictor',
  'DensityWaveAnalyzer':             'densityWaveAnalyzer',
  'DurationalContourTracker':        'durationalContourTracker',
  'DynamicArchitectPlanner':         'dynamicArchitectPlanner',
  'DynamicPeakMemory':               'dynamicPeakMemory',
  'DynamicRangeTracker':             'dynamicRangeTracker',
  'EnergyMomentumTracker':           'energyMomentumTracker',
  'VelocityShapeAnalyzer':           'velocityShapeAnalyzer',

  // ── conductor/harmonic ──
  'CadenceAdvisor':                  'cadenceAdvisor',
  'CadentialPreparationAdvisor':     'cadentialPreparationAdvisor',
  'ChromaticSaturationMonitor':      'chromaticSaturationMonitor',
  'ConsonanceDissonanceTracker':     'consonanceDissonanceTracker',
  'HarmonicDensityOscillator':       'harmonicDensityOscillator',
  'HarmonicFieldDensityTracker':     'harmonicFieldDensityTracker',
  'HarmonicPedalFieldTracker':       'harmonicPedalFieldTracker',
  'HarmonicRhythmDensityRatio':     'harmonicRhythmDensityRatio',
  'HarmonicSurpriseIndex':           'harmonicSurpriseIndex',
  'HarmonicVelocityMonitor':         'harmonicVelocityMonitor',
  'ModalColorTracker':               'modalColorTracker',
  'PitchClassGravityMap':            'pitchClassGravityMap',
  'PitchGravityCenter':              'pitchGravityCenter',
  'TensionResolutionTracker':        'tensionResolutionTracker',
  'TonalAnchorDistanceTracker':      'tonalAnchorDistanceTracker',

  // ── conductor/melodic ──
  'AmbitusMigrationTracker':         'ambitusMigrationTracker',
  'CounterpointMotionTracker':       'counterpointMotionTracker',
  'IntervalBalanceTracker':          'intervalBalanceTracker',
  'IntervalDirectionMemory':         'intervalDirectionMemory',
  'IntervalExpansionContractor':     'intervalExpansionContractor',
  'MelodicContourTracker':           'melodicContourTracker',
  'OctaveSpreadMonitor':             'octaveSpreadMonitor',
  'PhraseContourArchetypeDetector':  'phraseContourArchetypeDetector',
  'RegisterMigrationTracker':        'registerMigrationTracker',
  'RegisterPressureMonitor':         'registerPressureMonitor',
  'RegistralVelocityCorrelator':     'registralVelocityCorrelator',
  'TessituraPressureMonitor':        'tessituraPressureMonitor',
  'ThematicRecallDetector':          'thematicRecallDetector',
  'VoiceLeadingEfficiencyTracker':   'voiceLeadingEfficiencyTracker',

  // ── conductor/rhythmic ──
  'AccentPatternTracker':            'accentPatternTracker',
  'AttackDensityProfiler':           'attackDensityProfiler',
  'GrooveTemplateAdvisor':           'grooveTemplateAdvisor',
  'InterLayerRhythmAnalyzer':        'interLayerRhythmAnalyzer',
  'OnsetDensityProfiler':            'onsetDensityProfiler',
  'OnsetRegularityMonitor':          'onsetRegularityMonitor',
  'RhythmicComplexityGradient':      'rhythmicComplexityGradient',
  'RhythmicDensityContrastTracker':  'rhythmicDensityContrastTracker',
  'RhythmicGroupingAnalyzer':        'rhythmicGroupingAnalyzer',
  'RhythmicInertiaTracker':          'rhythmicInertiaTracker',
  'RhythmicSymmetryDetector':        'rhythmicSymmetryDetector',
  'SyncopationDensityTracker':       'syncopationDensityTracker',
  'TemporalProportionTracker':       'temporalProportionTracker',

  // ── conductor/signal ──
  'CoherenceMonitor':                'coherenceMonitor',
  'SignalHealthAnalyzer':            'signalHealthAnalyzer',
  'SystemDynamicsProfiler':          'systemDynamicsProfiler',

  // ── conductor/texture ──
  'ArticulationProfiler':            'articulationProfiler',
  'CrossLayerDensityBalancer':       'crossLayerDensityBalancer',
  'LayerCoherenceScorer':            'layerCoherenceScorer',
  'LayerEntryExitTracker':           'layerEntryExitTracker',
  'LayerIndependenceScorer':         'layerIndependenceScorer',
  'MotivicDensityTracker':           'motivicDensityTracker',
  'OrchestrationWeightTracker':      'orchestrationWeightTracker',
  'PedalPointDetector':              'pedalPointDetector',
  'PhraseLengthMomentumTracker':     'phraseLengthMomentumTracker',
  'RepetitionFatigueMonitor':        'repetitionFatigueMonitor',
  'RestDensityTracker':              'restDensityTracker',
  'SectionLengthAdvisor':            'sectionLengthAdvisor',
  'SilenceDistributionTracker':      'silenceDistributionTracker',
  'StructuralFormTracker':           'structuralFormTracker',
  'TexturalGradientTracker':         'texturalGradientTracker',
  'TexturalMemoryAdvisor':           'texturalMemoryAdvisor',
  'TimbreBalanceTracker':            'timbreBalanceTracker',
  'VoiceDensityBalancer':            'voiceDensityBalancer',

  // ── crossLayer ──
  'CrossLayerLifecycleManager':      'crossLayerLifecycleManager',
  'CrossLayerRegistry':              'crossLayerRegistry',
  'ExplainabilityBus':               'explainabilityBus',

  // ── crossLayer/dynamics ──
  'ArticulationComplement':          'articulationComplement',
  'CrossLayerDynamicEnvelope':       'crossLayerDynamicEnvelope',
  'DynamicRoleSwap':                 'dynamicRoleSwap',
  'RestSynchronizer':                'restSynchronizer',
  'TexturalMirror':                  'texturalMirror',
  'VelocityInterference':            'velocityInterference',

  // ── crossLayer/harmony ──
  'CadenceAlignment':                'cadenceAlignment',
  'ConvergenceHarmonicTrigger':      'convergenceHarmonicTrigger',
  'HarmonicIntervalGuard':           'harmonicIntervalGuard',
  'MotifEcho':                       'motifEcho',
  'MotifIdentityMemory':             'motifIdentityMemory',
  'PhaseAwareCadenceWindow':         'phaseAwareCadenceWindow',
  'PitchMemoryRecall':               'pitchMemoryRecall',
  'RegisterCollisionAvoider':        'registerCollisionAvoider',
  'SpectralComplementarity':         'spectralComplementarity',

  // ── crossLayer/rhythm ──
  'ConvergenceDetector':             'convergenceDetector',
  'EmergentDownbeat':                'emergentDownbeat',
  'FeedbackOscillator':              'feedbackOscillator',
  'GrooveTransfer':                  'grooveTransfer',
  'RhythmicComplementEngine':        'rhythmicComplementEngine',
  'RhythmicPhaseLock':               'rhythmicPhaseLock',
  'StutterContagion':                'stutterContagion',
  'TemporalGravity':                 'temporalGravity',

  // ── crossLayer/structure ──
  'AdaptiveTrustScores':             'adaptiveTrustScores',
  'CrossLayerClimaxEngine':          'crossLayerClimaxEngine',
  'CrossLayerSilhouette':            'crossLayerSilhouette',
  'InteractionHeatMap':              'interactionHeatMap',
  'NegotiationEngine':               'negotiationEngine',
  'SectionIntentCurves':             'sectionIntentCurves',

  // ── fx/stutter ── (longest first to prevent partial matches)
  'StutterFeedbackListener':         'stutterFeedbackListener',
  'StutterPlanScheduler':            'stutterPlanScheduler',
  'StutterConfigStore':              'stutterConfigStore',
  'StutterFailFast':                 'stutterFailFast',
  'StutterRegistry':                 'stutterRegistry',
  'StutterMetrics':                  'stutterMetrics',
  'StutterConfig':                   'stutterConfig',
  'Stutter':                         'stutter',

  // ── play ──
  'BeatPipelineDescriptor':          'beatPipelineDescriptor',
  'EventBus':                        'eventBus',
  'FullBootstrap':                   'fullBootstrap',
  'MainBootstrap':                   'mainBootstrap',

  // ── rhythm ──
  'ConductorRegulationListener':     'conductorRegulationListener',
  'DrumTextureCoupler':              'drumTextureCoupler',
  'EmissionFeedbackListener':        'emissionFeedbackListener',
  'FeedbackAccumulator':             'feedbackAccumulator',
  'JourneyRhythmCoupler':           'journeyRhythmCoupler',
  'PhaseLockedRhythmGenerator':      'phaseLockedRhythmGenerator',
  'RhythmHistoryTracker':            'rhythmHistoryTracker',
  'RhythmManager':                   'rhythmManager',
  'RhythmRegistry':                  'rhythmRegistry',
  'RhythmValues':                    'rhythmValues',

  // ── time ──
  'AbsoluteTimeGrid':                'absoluteTimeGrid',
  'AbsoluteTimeWindow':              'absoluteTimeWindow',
  'TempoFeelEngine':                 'tempoFeelEngine',
  'TimeStream':                      'timeStream',

  // ── utils ──
  'EventCatalog':                    'eventCatalog',
  'ModuleLifecycle':                 'moduleLifecycle',
  'SystemSnapshot':                  'systemSnapshot',
};

// ── File renames (PascalCase filenames → camelCase) ─────────────────────────
// These are NOT executed by this script. Only printed as git mv commands.
// Only includes files that are CURRENTLY PascalCase on disk.

const FILE_RENAMES = {
  // ── composers (root) ──
  'src/composers/IntervalComposer.js':                             'src/composers/intervalComposer.js',
  'src/composers/MeasureNotePool.js':                              'src/composers/measureNotePool.js',
  // ── composers/chord ──
  'src/composers/chord/ChordRegistry.js':                          'src/composers/chord/chordRegistry.js',
  'src/composers/chord/ChordValues.js':                            'src/composers/chord/chordValues.js',
  'src/composers/chord/PivotChordBridge.js':                       'src/composers/chord/pivotChordBridge.js',
  // ── composers/factory ──
  'src/composers/factory/FactoryManager.js':                       'src/composers/factory/FactoryManager.js',
  // ── composers/motif ──
  'src/composers/motif/CandidateExpansion.js':                     'src/composers/motif/candidateExpansion.js',
  'src/composers/motif/MotifChain.js':                             'src/composers/motif/motifChain.js',
  'src/composers/motif/MotifManager.js':                           'src/composers/motif/motifManager.js',
  'src/composers/motif/MotifRegistry.js':                          'src/composers/motif/motifRegistry.js',
  'src/composers/motif/MotifTransformAdvisor.js':                  'src/composers/motif/motifTransformAdvisor.js',
  'src/composers/motif/MotifTransforms.js':                        'src/composers/motif/motifTransforms.js',
  'src/composers/motif/MotifValidators.js':                        'src/composers/motif/motifValidators.js',
  'src/composers/motif/MotifValues.js':                            'src/composers/motif/motifValues.js',
  // ── composers/voice ──
  'src/composers/voice/RegisterBiasing.js':                        'src/composers/voice/registerBiasing.js',
  'src/composers/voice/VoiceLeadingCore.js':                       'src/composers/voice/voiceLeadingCore.js',
  'src/composers/voice/VoiceLeadingScorers.js':                    'src/composers/voice/voiceLeadingScorers.js',
  'src/composers/voice/VoiceRegistry.js':                          'src/composers/voice/voiceRegistry.js',
  'src/composers/voice/VoiceValues.js':                            'src/composers/voice/voiceValues.js',
  // ── conductor ──
  'src/conductor/ConductorIntelligence.js':                        'src/conductor/conductorIntelligence.js',
  'src/conductor/ConductorState.js':                               'src/conductor/conductorState.js',
  'src/conductor/DynamismEngine.js':                               'src/conductor/dynamismEngine.js',
  'src/conductor/GlobalConductor.js':                              'src/conductor/globalConductor.js',
  'src/conductor/GlobalConductorUpdate.js':                        'src/conductor/globalConductorUpdate.js',
  'src/conductor/HarmonicContext.js':                              'src/conductor/harmonicContext.js',
  'src/conductor/HarmonicJourney.js':                              'src/conductor/harmonicJourney.js',
  'src/conductor/HarmonicRhythmTracker.js':                        'src/conductor/harmonicRhythmTracker.js',
  'src/conductor/TextureBlender.js':                               'src/conductor/textureBlender.js',
  // ── conductor/dynamics ──
  'src/conductor/dynamics/ClimaxProximityPredictor.js':            'src/conductor/dynamics/climaxProximityPredictor.js',
  'src/conductor/dynamics/DensityWaveAnalyzer.js':                 'src/conductor/dynamics/densityWaveAnalyzer.js',
  'src/conductor/dynamics/DurationalContourTracker.js':            'src/conductor/dynamics/durationalContourTracker.js',
  'src/conductor/dynamics/DynamicArchitectPlanner.js':             'src/conductor/dynamics/dynamicArchitectPlanner.js',
  'src/conductor/dynamics/DynamicPeakMemory.js':                   'src/conductor/dynamics/dynamicPeakMemory.js',
  'src/conductor/dynamics/DynamicRangeTracker.js':                 'src/conductor/dynamics/dynamicRangeTracker.js',
  'src/conductor/dynamics/EnergyMomentumTracker.js':               'src/conductor/dynamics/energyMomentumTracker.js',
  'src/conductor/dynamics/VelocityShapeAnalyzer.js':               'src/conductor/dynamics/velocityShapeAnalyzer.js',
  // ── conductor/harmonic ──
  'src/conductor/harmonic/CadenceAdvisor.js':                      'src/conductor/harmonic/cadenceAdvisor.js',
  'src/conductor/harmonic/CadentialPreparationAdvisor.js':         'src/conductor/harmonic/cadentialPreparationAdvisor.js',
  'src/conductor/harmonic/ChromaticSaturationMonitor.js':          'src/conductor/harmonic/chromaticSaturationMonitor.js',
  'src/conductor/harmonic/ConsonanceDissonanceTracker.js':         'src/conductor/harmonic/consonanceDissonanceTracker.js',
  'src/conductor/harmonic/HarmonicDensityOscillator.js':           'src/conductor/harmonic/harmonicDensityOscillator.js',
  'src/conductor/harmonic/HarmonicFieldDensityTracker.js':         'src/conductor/harmonic/harmonicFieldDensityTracker.js',
  'src/conductor/harmonic/HarmonicPedalFieldTracker.js':           'src/conductor/harmonic/harmonicPedalFieldTracker.js',
  'src/conductor/harmonic/HarmonicRhythmDensityRatio.js':          'src/conductor/harmonic/harmonicRhythmDensityRatio.js',
  'src/conductor/harmonic/HarmonicSurpriseIndex.js':               'src/conductor/harmonic/harmonicSurpriseIndex.js',
  'src/conductor/harmonic/HarmonicVelocityMonitor.js':             'src/conductor/harmonic/harmonicVelocityMonitor.js',
  'src/conductor/harmonic/ModalColorTracker.js':                   'src/conductor/harmonic/modalColorTracker.js',
  'src/conductor/harmonic/PitchClassGravityMap.js':                'src/conductor/harmonic/pitchClassGravityMap.js',
  'src/conductor/harmonic/PitchGravityCenter.js':                  'src/conductor/harmonic/pitchGravityCenter.js',
  'src/conductor/harmonic/TensionResolutionTracker.js':            'src/conductor/harmonic/tensionResolutionTracker.js',
  'src/conductor/harmonic/TonalAnchorDistanceTracker.js':          'src/conductor/harmonic/tonalAnchorDistanceTracker.js',
  // ── conductor/melodic ──
  'src/conductor/melodic/AmbitusMigrationTracker.js':              'src/conductor/melodic/ambitusMigrationTracker.js',
  'src/conductor/melodic/CounterpointMotionTracker.js':            'src/conductor/melodic/counterpointMotionTracker.js',
  'src/conductor/melodic/IntervalBalanceTracker.js':               'src/conductor/melodic/intervalBalanceTracker.js',
  'src/conductor/melodic/IntervalDirectionMemory.js':              'src/conductor/melodic/intervalDirectionMemory.js',
  'src/conductor/melodic/IntervalExpansionContractor.js':          'src/conductor/melodic/intervalExpansionContractor.js',
  'src/conductor/melodic/MelodicContourTracker.js':                'src/conductor/melodic/melodicContourTracker.js',
  'src/conductor/melodic/OctaveSpreadMonitor.js':                  'src/conductor/melodic/octaveSpreadMonitor.js',
  'src/conductor/melodic/PhraseContourArchetypeDetector.js':       'src/conductor/melodic/phraseContourArchetypeDetector.js',
  'src/conductor/melodic/RegisterMigrationTracker.js':             'src/conductor/melodic/registerMigrationTracker.js',
  'src/conductor/melodic/RegisterPressureMonitor.js':              'src/conductor/melodic/registerPressureMonitor.js',
  'src/conductor/melodic/RegistralVelocityCorrelator.js':          'src/conductor/melodic/registralVelocityCorrelator.js',
  'src/conductor/melodic/TessituraPressureMonitor.js':             'src/conductor/melodic/tessituraPressureMonitor.js',
  'src/conductor/melodic/ThematicRecallDetector.js':               'src/conductor/melodic/thematicRecallDetector.js',
  'src/conductor/melodic/VoiceLeadingEfficiencyTracker.js':        'src/conductor/melodic/voiceLeadingEfficiencyTracker.js',
  // ── conductor/rhythmic ──
  'src/conductor/rhythmic/AccentPatternTracker.js':                'src/conductor/rhythmic/accentPatternTracker.js',
  'src/conductor/rhythmic/AttackDensityProfiler.js':               'src/conductor/rhythmic/attackDensityProfiler.js',
  'src/conductor/rhythmic/GrooveTemplateAdvisor.js':               'src/conductor/rhythmic/grooveTemplateAdvisor.js',
  'src/conductor/rhythmic/InterLayerRhythmAnalyzer.js':            'src/conductor/rhythmic/interLayerRhythmAnalyzer.js',
  'src/conductor/rhythmic/OnsetDensityProfiler.js':                'src/conductor/rhythmic/onsetDensityProfiler.js',
  'src/conductor/rhythmic/OnsetRegularityMonitor.js':              'src/conductor/rhythmic/onsetRegularityMonitor.js',
  'src/conductor/rhythmic/RhythmicComplexityGradient.js':          'src/conductor/rhythmic/rhythmicComplexityGradient.js',
  'src/conductor/rhythmic/RhythmicDensityContrastTracker.js':      'src/conductor/rhythmic/rhythmicDensityContrastTracker.js',
  'src/conductor/rhythmic/RhythmicGroupingAnalyzer.js':            'src/conductor/rhythmic/rhythmicGroupingAnalyzer.js',
  'src/conductor/rhythmic/RhythmicInertiaTracker.js':              'src/conductor/rhythmic/rhythmicInertiaTracker.js',
  'src/conductor/rhythmic/RhythmicSymmetryDetector.js':            'src/conductor/rhythmic/rhythmicSymmetryDetector.js',
  'src/conductor/rhythmic/SyncopationDensityTracker.js':           'src/conductor/rhythmic/syncopationDensityTracker.js',
  'src/conductor/rhythmic/TemporalProportionTracker.js':           'src/conductor/rhythmic/temporalProportionTracker.js',
  // ── conductor/texture ──
  'src/conductor/texture/ArticulationProfiler.js':                 'src/conductor/texture/articulationProfiler.js',
  'src/conductor/texture/CrossLayerDensityBalancer.js':            'src/conductor/texture/crossLayerDensityBalancer.js',
  'src/conductor/texture/LayerCoherenceScorer.js':                 'src/conductor/texture/layerCoherenceScorer.js',
  'src/conductor/texture/LayerEntryExitTracker.js':                'src/conductor/texture/layerEntryExitTracker.js',
  'src/conductor/texture/LayerIndependenceScorer.js':              'src/conductor/texture/layerIndependenceScorer.js',
  'src/conductor/texture/MotivicDensityTracker.js':                'src/conductor/texture/motivicDensityTracker.js',
  'src/conductor/texture/OrchestrationWeightTracker.js':           'src/conductor/texture/orchestrationWeightTracker.js',
  'src/conductor/texture/PedalPointDetector.js':                   'src/conductor/texture/pedalPointDetector.js',
  'src/conductor/texture/PhraseLengthMomentumTracker.js':          'src/conductor/texture/phraseLengthMomentumTracker.js',
  'src/conductor/texture/RepetitionFatigueMonitor.js':             'src/conductor/texture/repetitionFatigueMonitor.js',
  'src/conductor/texture/RestDensityTracker.js':                   'src/conductor/texture/restDensityTracker.js',
  'src/conductor/texture/SectionLengthAdvisor.js':                 'src/conductor/texture/sectionLengthAdvisor.js',
  // ── rhythm ──
  'src/rhythm/RhythmValues.js':                                    'src/rhythm/rhythmValues.js',
  'src/rhythm/StutterFeedbackListener.js':                         'src/rhythm/stutterFeedbackListener.js',
};

// ── Build regex patterns sorted longest-first ───────────────────────────────
// Longest-first guarantees e.g. 'stutterConfigStore' is tried before 'stutterConfig'.
// \b word boundaries ensure we only match whole identifiers:
//   \bStutterConfig\b does NOT match inside 'stutterConfigStore' (no boundary before 'S'→'tore').

const sortedNames = Object.keys(RENAMES).sort((a, b) => b.length - a.length);

const patterns = sortedNames.map(name => ({
  old: name,
  replacement: RENAMES[name],
  re: new RegExp('\\b' + escapeRegExp(name) + '\\b', 'g'),
}));

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Collect files ───────────────────────────────────────────────────────────

const EXTENSIONS = new Set(['.js', '.mjs', '.ts', '.json', '.md']);
const ALWAYS_SKIP = new Set(['node_modules', '.git', 'csv_maestro', '__pycache__']);

function walk(dir) {
  const results = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ALWAYS_SKIP.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    // Skip root-level output/, log/, tmp/ but allow nested dirs with same names
    const rel = path.relative(ROOT, full);
    if (rel === 'output' || rel === 'log' || rel === 'tmp') continue;
    if (ent.isDirectory()) {
      results.push(...walk(full));
    } else if (EXTENSIONS.has(path.extname(ent.name))) {
      results.push(full);
    }
  }
  return results;
}

// ── Apply replacements ──────────────────────────────────────────────────────

const files = walk(ROOT);
let filesChanged = 0;
let totalReplacements = 0;

for (const file of files) {
  // Never modify this script itself
  if (path.resolve(file) === SELF) continue;

  let content = fs.readFileSync(file, 'utf8');
  let fileReplacements = 0;

  for (const pat of patterns) {
    const matches = content.match(pat.re);
    if (matches) {
      fileReplacements += matches.length;
      content = content.replace(pat.re, pat.replacement);
    }
  }

  if (fileReplacements > 0) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    filesChanged++;
    totalReplacements += fileReplacements;

    if (APPLY) {
      fs.writeFileSync(file, content, 'utf8');
      console.log(`  ✓ ${rel}  (${fileReplacements} replacements)`);
    } else {
      console.log(`  [dry-run] ${rel}  (${fileReplacements} replacements)`);
    }
  }
}

// ── Print file rename commands ──────────────────────────────────────────────

console.log('');
console.log('── File renames (run these after applying text changes): ──');
for (const [oldPath, newPath] of Object.entries(FILE_RENAMES)) {
  console.log(`  git mv "${oldPath}" "${newPath}"`);
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`${APPLY ? '' : '[dry-run] '}${filesChanged} files, ${totalReplacements} replacements.`);
console.log(`${Object.keys(FILE_RENAMES).length} files to rename (git mv commands above).`);
if (!APPLY) {
  console.log('');
  console.log('Run with --apply to write changes:');
  console.log('  node scripts/fix-pascal-globals.js --apply');
}
console.log('');
console.log('After applying + git mv, run:  npm run main');
console.log('(This regenerates VALIDATED_GLOBALS from globals.d.ts)');
