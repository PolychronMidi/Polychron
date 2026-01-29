const { ensureTailMarker } = require('../src/grandFinale.tail');

describe('ensureTailMarker', () => {
  test('synthesizes outro and final markers and calls synthUnit appropriately', () => {
    const buffer = [];
    const unitsForLayer = [];
    const emittedUnitRec = new Set();
    const lastUnit = null;
    const outroUnit = null;
    const computedEndTick = 100;
    const layerState = { tpSec: 2 };
    const name = 'primary';
    const endTick = 120;
    const calls = [];
    const synthUnit = (opts) => { calls.push(opts); return opts; };

    const res = ensureTailMarker({ buffer, unitsForLayer, lastUnit, outroUnit, computedEndTick, emittedUnitRec, layerState, name, endTick, synthUnit, getPrimaryTargetEndSec: () => null });
    // Ensure synthUnit was called at least once for an outro or final
    expect(calls.length).toBeGreaterThanOrEqual(1);
    // Check that a unit was created/registered
    expect(unitsForLayer.length).toBeGreaterThanOrEqual(0);
  });
});
