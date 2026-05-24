// Shared root .env loader for Node entrypoints.

const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const values = new Map();
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const k = line.slice(0, eq).replace(/^export\s+/, '').trim();
    let v = line.slice(eq + 1).trim();
    const hashAt = v.indexOf(' #');
    if (hashAt > -1) v = v.slice(0, hashAt).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    values.set(k, v);
  }
  return values;
}

function expandEnvValues(values) {
  const expanded = new Map();
  const resolving = new Set();
  const resolve = (key) => {
    if (expanded.has(key)) return expanded.get(key);
    if (resolving.has(key)) throw new Error(`cyclic .env interpolation involving ${key}`);
    if (!values.has(key)) throw new Error(`.env references undefined key ${key}`);
    resolving.add(key);
    const raw = values.get(key);
    const value = String(raw).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, ref) => {
      const resolved = resolve(ref);
      if (resolved === undefined || resolved === '') {
        throw new Error(`unresolved .env interpolation ${key} references ${ref}`);
      }
      return String(resolved);
    });
    resolving.delete(key);
    expanded.set(key, value);
    return value;
  };
  for (const key of values.keys()) resolve(key);
  return expanded;
}

function loadEnv(envPath, opts) {
  const overwrite = !!(opts && opts.overwrite);
  if (!fs.existsSync(envPath)) throw new Error(`missing required .env at ${envPath}`);
  const values = expandEnvValues(parseEnvFile(envPath));
  let loaded = 0;
  let skipped = 0;
  for (const [k, v] of values.entries()) {
    if (overwrite || process.env[k] === undefined) {
      process.env[k] = v;
      loaded++;
    } else {
      skipped++;
    }
  }
  return { loaded, skipped, error: null };
}

let _defaultEnvLoaded = false;
function loadDefaultEnvForRequire() {
  if (_defaultEnvLoaded) return;
  loadEnv(defaultEnvPath(__dirname));
  _defaultEnvLoaded = true;
}

function requireEnv(key, validator) {
  let value = process.env[key];
  if (value === undefined || value === '') {
    loadDefaultEnvForRequire();
    value = process.env[key];
  }
  if (value === undefined || value === '') {
    throw new Error(`missing required environment key ${key}; declare it in root .env`);
  }
  if (validator && !validator(value)) {
    throw new Error(`invalid environment key ${key}=${JSON.stringify(value)}`);
  }
  return value;
}

function requireEnvInt(key) {
  const value = requireEnv(key);
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || String(n) !== String(value).trim()) {
    throw new Error(`invalid integer environment key ${key}=${JSON.stringify(value)}`);
  }
  return n;
}

function requireEnvFloat(key) {
  const value = requireEnv(key);
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) {
    throw new Error(`invalid float environment key ${key}=${JSON.stringify(value)}`);
  }
  return n;
}

function requireEnvBool(key) {
  const value = requireEnv(key).toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  throw new Error(`invalid boolean environment key ${key}=${JSON.stringify(process.env[key])}`);
}

function defaultEnvPath(callerDir) {
  return path.resolve(callerDir, '..', '..', '..', '..', '.env');
}

module.exports = {
  loadEnv,
  parseEnvFile,
  requireEnv,
  requireEnvInt,
  requireEnvFloat,
  requireEnvBool,
  defaultEnvPath,
};
