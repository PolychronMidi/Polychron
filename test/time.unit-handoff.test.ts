import { describe, it, expect } from 'vitest';
import { initializePlayEngine, getCurrentCompositionContext } from '../src/play.js';
import { setUnitTiming } from '../src/time.js';

describe('Unit handoff enforcement', () => {
  it('ensures every unit has unitHash and a unit_handoff marker at last tick', { timeout: 180000 }, async () => {
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const ctx = getCurrentCompositionContext();
    const tree = ctx.state.timingTree;
    for (const layer of Object.keys(tree)) {
      const layerNode = tree[layer];
      const walk = (n: any, parts: string[]) => {
        if (!n) return;
        const path = parts.join('/');
        if (n.unitHash) {
          // check buffer for handoff at last tick
          const buf = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [];
          const start = Number(n.start ?? 0);
          const end = Number(n.end ?? 0);
          const lastTick = Math.max(Math.round(start), Math.round(end) - 1);
          const found = (buf || []).some((r: any) => r && r.type === 'unit_handoff' && Number.isFinite(r.tick) && Math.round(r.tick) === lastTick && Array.isArray(r.vals) && String(r.vals[0]) === String(n.unitHash));
          expect(found, `handoff for ${path} present at tick=${lastTick}`).toBe(true);
        }
        for (const k of Object.keys(n.children || {})) walk(n.children[k], parts.concat(k));
      };
      walk(layerNode, [layer]);
    }
  });

  it('throws when previous unit handoff is missing for next unit', { timeout: 180000 }, async () => {
    await initializePlayEngine(undefined, undefined, { seed: 12345 });
    const ctx = getCurrentCompositionContext();
    const layer = 'primary';
    // Remove all unit_handoff markers to simulate missing handoff
    const buf = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [] as any[];
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i] && buf[i].type === 'unit_handoff') buf.splice(i, 1);
    }

    // Move to second measure and attempt to setUnitTiming('measure') which should enforce prev handoff
    ctx.state.measureIndex = 1;
    // Ensure the LM's active layer is the same layer we removed handoffs from
    ctx.LM.activeLayer = layer;


    // Instead of relying on prepopulated unitHash, create a concrete previous measure
    // by setting measureIndex=0 and calling setUnitTiming to guarantee unitHash+handoff emission.
    // Target section 0/phrase 0 explicitly so we create a predictable prev measure
    ctx.state.sectionIndex = 0;
    ctx.state.phraseIndex = 0;
    ctx.state.measureIndex = 0;

    // Ensure active layer
    ctx.LM.activeLayer = layer;

    // Create previous measure timing (this will emit its unit_handoff)
    setUnitTiming('measure', ctx as any);

    // Sanity checks: prev node has unitHash and handoff was emitted
    const tree = ctx.state.timingTree;
    const prevPath = `primary/section/${ctx.state.sectionIndex ?? 0}/phrase/${ctx.state.phraseIndex ?? 0}/measure/0`;
    const prevNode = (tree && (tree as any).children && (tree as any).children['primary'] && (tree as any).children['primary'].children && (tree as any).children['primary'].children['section'] && (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)] && (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)].children && (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)].children['phrase'] && (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)].children['phrase'][String(ctx.state.phraseIndex ?? 0)].children['measure'] && (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)].children['phrase'][String(ctx.state.phraseIndex ?? 0)].children['measure'][0]) ? (tree as any).children['primary'].children['section'][String(ctx.state.sectionIndex ?? 0)].children['phrase'][String(ctx.state.phraseIndex ?? 0)].children['measure'][0] : null;
    console.error('DEBUG: prevNode.unitHash=', prevNode && prevNode.unitHash);
    const bufBeforeRemove = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [] as any[];
    const foundBefore = (bufBeforeRemove || []).some((r:any) => r && r.type === 'unit_handoff');
    const firstHandoff = (bufBeforeRemove || []).find((r:any) => r && r.type === 'unit_handoff');
    console.error('DEBUG: firstHandoff=', firstHandoff);
    expect(foundBefore, 'handoff should have been emitted for previous measure').toBe(true);

    const findByHash = (n:any, key:any) => {
      if (!n) return null;
      if (n.unitHash && String(n.unitHash) === String(key)) return n;
      for (const k of Object.keys(n.children || {})) {
        const res = findByHash(n.children[k], key);
        if (res) return res;
      }
      return null;
    };
    const unitHashVal = firstHandoff && Array.isArray(firstHandoff.vals) ? firstHandoff.vals[0] : null;
    const nodeFromHash = findByHash(ctx.state.timingTree, unitHashVal);
    console.error('DEBUG: nodeFromHash=', !!nodeFromHash, 'unitHashVal=', unitHashVal);
    expect(nodeFromHash, 'timing tree should contain the emitted handoff hash').toBeTruthy();

    // Remove all unit_handoff markers to simulate missing handoff (for primary layer)
    const bufRemoved = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [] as any[];
    for (let i = bufRemoved.length - 1; i >= 0; i--) {
      if (bufRemoved[i] && bufRemoved[i].type === 'unit_handoff') bufRemoved.splice(i, 1);
    }

    // Now move to second measure and attempt to setUnitTiming('measure') which should enforce prev handoff
    ctx.state._enforceHandoffs = true;
    ctx.state.measureIndex = 1;

    const buf2 = ctx.LM.layers[layer] && ctx.LM.layers[layer].buffer ? (ctx.LM.layers[layer].buffer.rows || ctx.LM.layers[layer].buffer) : [] as any[];
    const anyHandoffs = (buf2 || []).some((r:any) => r && r.type === 'unit_handoff');

    // Attempt to set and assert it throws
    let threw = false;
    try {
      setUnitTiming('measure', ctx as any);
    } catch (e:any) {
      // console.error('setUnitTiming threw:', e && e.message);
      threw = true;
    }

    if (!threw) {
      console.error('DEBUG: handoff removal did not cause setUnitTiming to throw; anyHandoffs=', anyHandoffs);
      console.error('DEBUG: buffer sample:', (buf||[]).slice(0,20));
    }

    expect(threw, 'setUnitTiming should throw when handoff missing').toBe(true);
  });
});
