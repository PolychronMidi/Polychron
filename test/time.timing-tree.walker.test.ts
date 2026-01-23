import { initTimingTree, buildPath, getTimingValues } from '../src/TimingTree.js';
import { createTestContext } from './helpers';
import { getMidiTiming, setUnitTiming } from '../src/time.js';

describe('TimingTree walker - verifies sequential measure starts per-layer', () => {
  test('measures start sequentially and respect per-measure tpMeasure values across layers', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4;
    ctx.state.denominator = 4;
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;

    // Initialize base timing and phrase
    getMidiTiming(ctx);
    setUnitTiming('phrase', ctx);

    const tree = initTimingTree(ctx);

    function runLayerMeasures(layerName: string) {
      // Simulate LayerManager by providing LM.activeLayer and a layer buffer
      ctx.LM = { activeLayer: layerName, layers: { [layerName]: { buffer: ctx.csvBuffer } } } as any;

      // Choose varied tpMeasure values (ticks per measure) per measure
      const tpValues = [ctx.state.tpMeasure || 480, Math.max(1, Math.round((ctx.state.tpMeasure || 480) * 0.75)), Math.max(1, Math.round((ctx.state.tpMeasure || 480) * 1.5))];

      // Apply per-measure tpMeasure and write measure nodes
      for (let i = 0; i < tpValues.length; i++) {
        ctx.state.measureIndex = i;
        ctx.state.tpMeasure = tpValues[i];
        setUnitTiming('measure', ctx);
      }

      // Walk measures and verify sequential starts
      let prevStart: number | null = null;
      let prevTp: number | null = null;
      for (let i = 0; i < tpValues.length; i++) {
        const path = buildPath(layerName, 0, 0, i);
        const node = getTimingValues(tree, path);
        expect(node, `node exists for ${path}`).toBeDefined();
        expect(node!.tpMeasure, `${path} has correct tpMeasure`).toBe(tpValues[i]);
        const start = node!.measureStart;
        expect(Number.isFinite(start)).toBeTruthy();

        if (i === 0) {
          // First measure starts at phraseStart
          expect(start).toBe(ctx.state.phraseStart);
        } else {
          // Next measure should start at previous start + previous tpMeasure
          expect(prevStart).not.toBeNull();
          expect(prevTp).not.toBeNull();
          expect(start).toBe(prevStart! + prevTp!);
        }

        prevStart = start;
        prevTp = node!.tpMeasure;
      }
    }

    // Run for both primary and poly layers (per-layer independence)
    runLayerMeasures('primary');
    runLayerMeasures('poly');
  });
});
