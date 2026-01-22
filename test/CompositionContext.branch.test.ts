import { describe, it, expect, beforeEach } from 'vitest';
import { createCompositionContext, syncContextToGlobals, loadContextFromGlobals } from '../src/CompositionContext';
import { DIContainer } from '../src/DIContainer';
import { CompositionEventBusImpl } from '../src/CompositionProgress';
import { getPolychronContext } from '../src/PolychronInit';

describe('CompositionContext - branch tests', () => {
  let container: DIContainer;
  let eventBus: CompositionEventBusImpl;

  beforeEach(() => {
    container = new DIContainer();
    eventBus = new CompositionEventBusImpl();
    // clean DI namespaces
    const poly = getPolychronContext();
    delete poly.test?.BPM;
    delete poly.test?.PPQ;
    delete poly.test?.SECTIONS;
    delete poly.test?.COMPOSERS;
  });

  it('createCompositionContext returns a usable context', () => {
    const ctx = createCompositionContext(container, eventBus, { BPM: 100, PPQ: 480, SECTIONS: { min: 1, max: 4 }, COMPOSERS: [] });
    expect(ctx.BPM).toBe(100);
    expect(ctx.PPQ).toBe(480);
    expect(typeof ctx.logUnit).toBe('function');
    expect(typeof ctx.setUnitTiming).toBe('function');
  });

  it('syncContextToGlobals and loadContextFromGlobals preserve config and state', () => {
    const ctx = createCompositionContext(container, eventBus, { BPM: 77, PPQ: 300, SECTIONS: { min: 2, max: 8 }, COMPOSERS: ['a'] });
    ctx.state.sectionIndex = 3;
    ctx.LOG = 'test';

    syncContextToGlobals(ctx);
    const poly = getPolychronContext();
    expect(poly.test.BPM).toBe(77);
    expect(poly.test.PPQ).toBe(300);
    expect(poly.test.SECTIONS.min).toBe(2);
    expect(poly.test.COMPOSERS[0]).toBe('a');

    // load from DI namespaces
    const loaded = loadContextFromGlobals(container, eventBus);
    expect(loaded.BPM).toBe(77);
    expect(loaded.PPQ).toBe(300);
    expect(loaded.state.sectionIndex).toBe(3);
  });
});
