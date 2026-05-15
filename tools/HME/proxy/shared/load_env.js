'use strict';
// Shared .env loader for Node entrypoints (proxy, future daemons).
// Parent shell may not have sourced .env; loader reads from disk directly.

const fs = require('fs');
const path = require('path');

function loadEnv(envPath, opts) {
  const overwrite = !!(opts && opts.overwrite);
  try {
    if (!fs.existsSync(envPath)) return { loaded: 0, skipped: 0, error: null };
    let loaded = 0;
    let skipped = 0;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      const hashAt = v.indexOf(' #');
      if (hashAt > -1) v = v.slice(0, hashAt).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (overwrite || process.env[k] === undefined) {
        process.env[k] = v;
        loaded++;
      } else {
        skipped++;
      }
    }
    return { loaded, skipped, error: null };
  } catch (e) {
    // silent-ok: optional fallback path.
    return { loaded: 0, skipped: 0, error: e };
  }
}

// tools/HME/proxy/shared/* -> .env at project root (4 levels up).
function defaultEnvPath(callerDir) {
  return path.resolve(callerDir, '..', '..', '..', '..', '.env');
}

module.exports = { loadEnv, defaultEnvPath };
