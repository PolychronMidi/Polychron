# Source-to-Test Mapping Analysis
## Generated: 2026-01-18 07:36

## COMPLETE CONCORDANCE MAP

###  Perfect 1-to-1 Matches (Have dedicated tests)
-  src/backstage.ts  test/backstage.test.ts
-  src/ComposerRegistry.ts  test/ComposerRegistry.test.ts
-  src/composers.ts  test/composers.test.ts
-  src/DIContainer.ts  test/DIContainer.test.ts
-  src/EventBus.ts  test/EventBus.test.ts
-  src/fxManager.ts  test/fxManager.test.ts
-  src/ModuleInitializer.ts  test/ModuleInitializer.test.ts
-  src/motifs.ts  test/motifs.test.ts
-  src/play.ts  test/play.test.ts
-  src/PolychronConfig.ts  test/PolychronConfig.test.ts
-  src/PolychronContext.ts  test/PolychronContext.test.ts
-  src/rhythm.ts  test/rhythm.test.ts
-  src/stage.ts  test/stage.test.ts
-  src/structure.ts  test/structure.test.ts
-  src/time.ts  test/time.test.ts
-  src/venue.ts  test/venue.test.ts
-  src/voiceLeading.ts  test/voiceLeading.test.ts
-  src/writer.ts  test/writer.test.ts

###  Source Files WITHOUT Dedicated Tests
-  src/CancellationToken.ts (needs test/CancellationToken.test.ts)
-  src/CompositionContext.ts (needs test/CompositionContext.test.ts)
-  src/CompositionProgress.ts (needs test/CompositionProgress.test.ts)
-  src/CompositionState.ts (needs test/CompositionState.test.ts)
-  src/playNotes.ts (needs test/playNotes.test.ts)
-  src/PolychronError.ts (needs test/PolychronError.test.ts)
-  src/PolychronInit.ts (needs test/PolychronInit.test.ts)
-  src/sheet.ts (needs test/sheet.test.ts)
-  src/TimingTree.ts (needs test/TimingTree.test.ts)
-  src/utils.ts (needs test/utils.test.ts)

###  src/composers/ Subdirectory (needs parallel test/composers/)
- src/composers/ChordComposer.ts (tested in monolithic composers.test.ts)
- src/composers/GenericComposer.ts (tested in monolithic composers.test.ts)
- src/composers/index.ts (tested in monolithic composers.test.ts)
- src/composers/MeasureComposer.ts (tested in monolithic composers.test.ts)
- src/composers/ModeComposer.ts (tested in monolithic composers.test.ts)
- src/composers/PentatonicComposer.ts (tested in monolithic composers.test.ts)
- src/composers/ProgressionGenerator.ts (tested in monolithic composers.test.ts)
- src/composers/ScaleComposer.ts (tested in monolithic composers.test.ts)

###  src/voiceLeading/ Subdirectory 
- src/voiceLeading/VoiceLeadingScore.ts (tested in monolithic voiceLeading.test.ts)
