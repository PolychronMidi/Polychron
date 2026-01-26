import { it } from 'vitest';

// Temporary debug test: print active handles/requests to diagnose test-suite hang.
// Will be removed after we find the leak.
it('debug: print active handles and requests', (done) => {
  // Wait briefly to allow any pending microtasks to settle
  setTimeout(() => {
    try {
      // Use internal Node APIs to inspect handles/requests
      const handles = (process && process._getActiveHandles) ? process._getActiveHandles() : [];
      const requests = (process && process._getActiveRequests) ? process._getActiveRequests() : [];
      // Print summaries to stdout for diagnosis
      console.log('\n=== DEBUG: Active handles summary ===');
      console.log('handles count:', handles.length);
      handles.forEach((h, i) => {
        console.log(`handle[${i}] type=${h && h.constructor && h.constructor.name}`, h && h.constructor && Object.keys(h).slice(0,6));
      });
      console.log('\n=== DEBUG: Active requests summary ===');
      console.log('requests count:', requests.length);
      requests.forEach((r, i) => {
        console.log(`request[${i}] type=${r && r.constructor && r.constructor.name}`, r && Object.keys(r).slice(0,6));
      });
      // Do not fail the suite; we just want diagnostics. Mark done.
      done();
    } catch (e) {
      // If introspection fails, still finish so tests can complete
      console.log('Debug introspection failed:', e && e.stack ? e.stack : e);
      done();
    }
  }, 200);
});
