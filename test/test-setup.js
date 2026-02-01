// Test setup helper: initialize minimal runtime globals required by unit tests
// Prefer the full runtime: require the canonical `stage.js` (it imports the rest of the project)
try { require('../src/stage'); } catch (e) { /* swallow to allow partial test runs */ }
// Ensure fx helpers are available for lightweight tests without importing entire stage
try { require('../src/fx'); } catch (e) { /* swallow */ }
// Keep this file focused and lightweight so unit tests don't require the full runtime when not needed
try { if (typeof __POLYCHRON_TEST__ === 'undefined') __POLYCHRON_TEST__ = {}; } catch (e) { /* swallow */ }

// No fallback globals here — rely on the canonical `src/stage` initializer to populate naked globals.
// This keeps `src/` files clean and ensures tests use the real runtime state.
// If a test needs a lightweight environment it should explicitly require modules or set specific globals within the test file itself.
