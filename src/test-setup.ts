// Test setup: silence noisy console output during tests to avoid performance issues
// This will mute console.log/warn/error/debug/info when running under NODE_ENV=test
// but preserves the originals on console._orig* so they can be restored if needed.

if (process.env.NODE_ENV === 'test' || process.env.POLYCHRON_SILENT === '1') {
  const noop = () => {};
  try {
    (console as any)._origLog = console.log;
    (console as any)._origError = console.error;
    (console as any)._origWarn = console.warn;
    (console as any)._origDebug = console.debug;
    (console as any)._origInfo = console.info;
  } catch (_e) {}
  // Mute common console outputs during tests
  console.log = noop as any;
  console.error = noop as any;
  console.warn = noop as any;
  console.debug = noop as any;
  console.info = noop as any;
}
