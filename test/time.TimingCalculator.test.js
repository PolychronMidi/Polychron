let TimingCalculator;

// Dynamic import to support CommonJS implementation while running under Vitest ESM harness
test.beforeAll(async () => {
  const mod = await import('../src/time/TimingCalculator');
  TimingCalculator = mod.default || mod;
});

test('TimingCalculator computes midi timing for 4/4 120bpm 480ppq', () => {
  const tc = new TimingCalculator({ bpm: 120, ppq: 480, meter: [4, 4] });
  expect(tc.midiMeter).toEqual([4, 4]);
  expect(tc.tpSec).toBe(120 * 480 / 60); // 960
  expect(tc.tpMeasure).toBe(480 * 4 * (4 / 4)); // 1920
  expect(tc.spMeasure).toBeCloseTo((60 / 120) * 4 * 1); // 2 seconds
});

test('TimingCalculator rejects invalid meter or bpm/ppq', () => {
  expect(() => new TimingCalculator({ bpm: 0, ppq: 480, meter: [4, 4] })).toThrow();
  expect(() => new TimingCalculator({ bpm: 120, ppq: 0, meter: [4, 4] })).toThrow();
  expect(() => new TimingCalculator({ bpm: 120, ppq: 480, meter: [4, 0] })).toThrow();
});
