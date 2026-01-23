import { createTestContext } from './helpers.module.ts';
import { getMidiTiming, setUnitTiming } from '../src/time.js';
import { initTimingTree, getTimingValues } from '../src/TimingTree.js';
import { grandFinale } from '../src/writer.js';
import * as fs from 'fs';

describe('Section offsets and grandFinale unit detection', () => {
  it('emitted unit markers should include section indices and grandFinale should compute offsets', () => {
    const ctx = createTestContext();
    ctx.state.numerator = 4; ctx.state.denominator = 4;
    getMidiTiming(ctx);

    // Simulate section 0 phrase 0 and section 1 phrase 0 both starting at 0 locally
    ctx.state.sectionIndex = 0; ctx.state.phraseIndex = 0;
    setUnitTiming('phrase', ctx);
    // artificially set a long end on first phrase
    const tree = initTimingTree(ctx);
    const p0 = getTimingValues(tree, 'primary/section/0');
    if (p0) p0.end = Number(p0.tpPhrase || 0) * 1;

    // Simulate advancing to next section and emit a phrase that also starts at 0 (local)
    // (In tests we simulate Section advance by bumping sectionStart and sectionIndex)
    ctx.state.sectionStart = (ctx.state.sectionStart || 0) + (ctx.state.tpSection || 0);
    ctx.state.sectionIndex = 1; ctx.state.phraseIndex = 0;
    setUnitTiming('phrase', ctx);

    // Run grandFinale to generate units.json in output using a minimal env that supplies LM
    const env: any = { LM: { layers: { primary: { buffer: ctx.csvBuffer, state: ctx.state } } }, state: ctx.state, PPQ: ctx.state.PPQ || 480, fs };
    grandFinale(env);

    const units = JSON.parse(fs.readFileSync('output/units.json','utf8'));
    const u0 = units.units.find((u:any)=>u.unitHash && u.sectionIndex===0);
    const u1 = units.units.find((u:any)=>u.unitHash && u.sectionIndex===1);

    expect(u0).toBeDefined();
    expect(u1).toBeDefined();
    // After offsets, u1.startTick should be >= u0.endTick
    expect(Number(u1.startTick)).toBeGreaterThanOrEqual(Number(u0.endTick));
  });
});
