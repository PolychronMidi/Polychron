// bootstrap-fallbacks.js - Minimal fallbacks for small globals used across modules
try { if (typeof p === 'undefined') p = (buff, ...items) => { if (!buff) return; if (typeof buff.push === 'function') buff.push(...items); else if (Array.isArray(buff)) buff.push(...items); }; } catch (e) { /* swallow */ }
try {
  if (typeof CSVBuffer === 'undefined') {
    class _CSVBufferShim {
      constructor(name) { this.name = name; this.rows = []; }
      push(...items) { this.rows.push(...items); }
      get length() { return this.rows.length; }
      clear() { this.rows = []; }
    }
    CSVBuffer = _CSVBufferShim;
  }
} catch (e) { /* swallow */ }

// Minimal stub for logUnit and other writer helpers that may not be present yet
try { if (typeof logUnit === 'undefined') logUnit = (type) => {}; } catch (e) { /* swallow */ }
