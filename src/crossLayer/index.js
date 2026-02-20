// src/crossLayer/index.js — Central entry for cross-layer interaction modules.

// Registry MUST load first so every module below can self-register.
// @ts-ignore: side-effect module load
require('./CrossLayerRegistry');

// @ts-ignore: side-effect module load
require('./explainabilityBus');
// @ts-ignore: side-effect module load
require('./adaptiveTrustScores');
// @ts-ignore: side-effect module load
require('./sectionIntentCurves');
// @ts-ignore: side-effect module load
require('./phaseAwareCadenceWindow');
// @ts-ignore: side-effect module load
require('./negotiationEngine');
// @ts-ignore: side-effect module load
require('./grooveTransfer');
// @ts-ignore: side-effect module load
require('./registerCollisionAvoider');
// @ts-ignore: side-effect module load
require('./motifIdentityMemory');
// @ts-ignore: side-effect module load
require('./harmonicIntervalGuard');
// @ts-ignore: side-effect module load
require('./restSynchronizer');
// @ts-ignore: side-effect module load
require('./crossLayerClimaxEngine');
// @ts-ignore: side-effect module load
require('./rhythmicComplementEngine');
// @ts-ignore: side-effect module load
require('./pitchMemoryRecall');
// @ts-ignore: side-effect module load
require('./articulationComplement');
// @ts-ignore: side-effect module load
require('./crossLayerDynamicEnvelope');
// @ts-ignore: side-effect module load
require('./convergenceHarmonicTrigger');
// @ts-ignore: side-effect module load
require('./texturalMirror');
// @ts-ignore: side-effect module load
require('./crossLayerSilhouette');

// @ts-ignore: side-effect module load
require('./stutterContagion');
// @ts-ignore: side-effect module load
require('./convergenceDetector');
// @ts-ignore: side-effect module load
require('./temporalGravity');
// @ts-ignore: side-effect module load
require('./velocityInterference');
// @ts-ignore: side-effect module load
require('./feedbackOscillator');
// @ts-ignore: side-effect module load
require('./cadenceAlignment');
// @ts-ignore: side-effect module load
require('./rhythmicPhaseLock');
// @ts-ignore: side-effect module load
require('./spectralComplementarity');
// @ts-ignore: side-effect module load
require('./dynamicRoleSwap');
// @ts-ignore: side-effect module load
require('./motifEcho');
// @ts-ignore: side-effect module load
require('./interactionHeatMap');
// @ts-ignore: side-effect module load
require('./entropyRegulator');
// @ts-ignore: side-effect module load
require('./emergentDownbeat');

// Lifecycle manager loads LAST — after all modules have self-registered.
// @ts-ignore: side-effect module load
require('./crossLayerLifecycleManager');
