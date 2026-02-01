require('../src/rhythm/trackRhythm');

test('trackRhythm increments on when played=true', () => {
  const ctx = {};
  trackRhythm('subdiv', ctx, true);
  expect(ctx.subdivsOn).toBe(1);
  expect(ctx.subdivsOff).toBe(0);
});

test('trackRhythm increments off when played=false', () => {
  const ctx = {};
  trackRhythm('subdiv', ctx, false);
  expect(ctx.subdivsOff).toBe(1);
  expect(ctx.subdivsOn).toBe(0);
});

test('trackRhythm falls back to rhythm array when played omitted', () => {
  const ctx = { subdivRhythm: [0,1], subdivIndex: 1 };
  trackRhythm('subdiv', ctx);
  expect(ctx.subdivsOn).toBe(1);
  expect(ctx.subdivsOff).toBe(0);
});

test('trackRhythm handles unknown unit gracefully', () => {
  const ctx = {};
  // Should not throw
  expect(() => trackRhythm('unknownUnit', ctx, true)).not.toThrow();
});
