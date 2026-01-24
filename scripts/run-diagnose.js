// Simple node script to reproduce setUnitTiming behavior outside vitest
const { createTestContext } = require('../test/helpers.module.js');
const { setUnitTiming } = require('../dist/time.js');
const { initTimingTree } = require('../dist/TimingTree.js');

function run() {
  const ctx = createTestContext();
  ctx.state.sectionIndex = 0; ctx.state.phraseIndex = 0;
  try {
    setUnitTiming('phrase', ctx);
    const tree = initTimingTree(ctx);
    console.log('CTX STATE SNAPSHOT:', { tpPhrase: ctx.state.tpPhrase, tpMeasure: ctx.state.tpMeasure, phraseStart: ctx.state.phraseStart, sectionStart: ctx.state.sectionStart, sectionIndex: ctx.state.sectionIndex, phraseIndex: ctx.state.phraseIndex });
    console.log('TIMING TREE:', JSON.stringify(tree, null, 2));
  } catch (e) {
    console.error('ERROR:', e && e.message ? e.message : e);
  }
}

run();
