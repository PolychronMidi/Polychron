const { parseMarkersAndBackfill } = require('../src/grandFinale.parse');

describe('parseMarkersAndBackfill', () => {
  test('extracts unitRec markers and backfills event unitHash', () => {
    const buffer = [
      { tick: 10, type: 'marker_t', vals: ['unitRec:primary|section1|phrase1|10-20|0.000000-1.000000'] },
      { tick: 12, type: 'on', vals: ['60'], _tickSortKey: 12 }
    ];
    const unitsForLayer = [];
    parseMarkersAndBackfill(buffer, unitsForLayer);
    expect(unitsForLayer.length).toBeGreaterThan(0);
    expect(unitsForLayer[0].unitId).toMatch(/primary\|/);
    // the event should have been backfilled with _unitHash
    expect(buffer[1]._unitHash).toBe(unitsForLayer[0].unitId);
  });
});
