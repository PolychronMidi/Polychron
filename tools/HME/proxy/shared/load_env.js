'use strict';
// Shared .env loader for Node entrypoints (proxy, future daemons).
// Parent shell may not have sourced .env; loader reads from disk directly.

const fs = require('fs');
const path = require('path');

function parseEnvFile(filePath) {
  const values = new Map();
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
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
    values.set(k, v);
  }
  return values;
}

function templateEnvPath(envPath, opts = {}) {
  if (opts.templatePath) return opts.templatePath;
  const root = path.dirname(path.resolve(envPath));
  const configured = process.env.HME_ENV_FAILFAST_TEMPLATE;
  return path.resolve(root, configured || 'doc/templates/.env.example');
}

function validateAgainstTemplate(envPath, values, opts = {}) {
  if (opts.validateTemplate === false) return;
  const tpl = templateEnvPath(envPath, opts);
  if (!fs.existsSync(tpl)) {
    throw new Error(`env template missing at ${tpl}; .env defaults must live in doc/templates/.env.example`);
  }
  const declared = parseEnvFile(tpl);
  const missing = [];
  for (const key of declared.keys()) {
    if (!values.has(key) || values.get(key) === '') missing.push(key);
  }
  if (missing.length) {
    throw new Error(`.env missing required template key(s): ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ` ... ${missing.length - 20} more` : ''}`);
  }
}

function loadEnv(envPath, opts) {
  const overwrite = !!(opts && opts.overwrite);
  if (!fs.existsSync(envPath)) {
    throw new Error(`missing required .env at ${envPath}`);
  }
  const values = parseEnvFile(envPath);
  validateAgainstTemplate(envPath, values, opts || {});
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

function requireEnv(key, validator) {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(`missing required environment key ${key}; declare it in .env and doc/templates/.env.example`);
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

// tools/HME/proxy/shared/* -> .env at project root (4 levels up).
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
