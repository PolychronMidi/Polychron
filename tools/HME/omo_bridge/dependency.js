'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { satisfies } = require('semver');
const { PROJECT_ROOT } = require('../proxy/shared');
const { emitOmo } = require('./telemetry');

function _envRequired(name) {
  if (!Object.prototype.hasOwnProperty.call(process.env, name)) throw new Error(`missing required environment key ${name}`);
  return process.env[name];
}
function _isAbsoluteInsideRoot(p) {
  const abs = path.resolve(p);
  const root = path.resolve(PROJECT_ROOT);
  return abs === root || abs.startsWith(root + path.sep);
}
function _gitCommit(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', timeout: 2000 });
  return r.status === 0 ? r.stdout.trim() : '';
}
function _packageJson(root) {
  const p = path.join(root, 'package.json');
  if (!fs.existsSync(p)) return {};
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (_) { return {}; }
}
function _entryExists(root, entry) { return fs.existsSync(path.join(root, entry)); }
function _detectEntrypoint(root, pkg) {
  const candidates = [pkg.main, pkg.module, 'dist/index.js', 'index.js', 'src/index.js'].filter(Boolean);
  return candidates.find((c) => fs.existsSync(path.join(root, c))) || '';
}
function _findPackageJsonFromEntrypoint(entrypoint) {
  let dir = path.dirname(entrypoint);
  const root = path.parse(dir).root;
  while (dir && dir !== root) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return '';
}
function _resolvePackageBySearchPath(pkgName) {
  const searchPaths = require.resolve.paths(pkgName) || [];
  const candidates = [path.join(PROJECT_ROOT, 'node_modules'), ...searchPaths];
  for (const base of candidates) {
    const pkgJsonPath = path.join(base, pkgName, 'package.json');
    if (fs.existsSync(pkgJsonPath)) return path.dirname(pkgJsonPath);
  }
  return '';
}
function _resolvePackage(pkgName) {
  if (!pkgName) throw new Error('HME_OMO_PACKAGE is required when HME_OMO_SOURCE=package');
  try {
    const pkgJsonPath = require.resolve(path.join(pkgName, 'package.json'), { paths: [PROJECT_ROOT] });
    return path.dirname(pkgJsonPath);
  } catch (err) {
    const bySearchPath = _resolvePackageBySearchPath(pkgName);
    if (bySearchPath) return bySearchPath;
    if (err && err.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw err;
    const entrypoint = require.resolve(pkgName, { paths: [PROJECT_ROOT] });
    const pkgJsonPath = _findPackageJsonFromEntrypoint(entrypoint);
    if (!pkgJsonPath) throw new Error(`could not locate package.json for ${pkgName}`);
    return path.dirname(pkgJsonPath);
  }
}
function _resolvePath(configuredPath) {
  if (!configuredPath) throw new Error('HME_OMO_PATH is required when HME_OMO_SOURCE=path');
  if (path.isAbsolute(configuredPath) && !_isAbsoluteInsideRoot(configuredPath)) {
    throw new Error('HME_OMO_PATH must be relative to PROJECT_ROOT or inside PROJECT_ROOT');
  }
  const root = path.resolve(PROJECT_ROOT, configuredPath);
  if (!fs.existsSync(root)) throw new Error(`HME_OMO_PATH does not exist: ${configuredPath}`);
  return root;
}

function resolveOmo(options = {}) {
  const telemetry = options.telemetry;
  const enabledValue = options.enabled ?? _envRequired('HME_OMO_ENABLED');
  const enabled = enabledValue === true || String(enabledValue) === '1';
  const source = String(options.source ?? _envRequired('HME_OMO_SOURCE'));
  if (!enabled || source === 'disabled') {
    const result = { enabled: false, source: 'disabled', status: 'disabled' };
    emitOmo('omo_dependency_resolved', result, telemetry);
    return result;
  }
  try {
    let root = '';
    let packageName = '';
    if (source === 'package') {
      packageName = String(options.packageName ?? _envRequired('HME_OMO_PACKAGE'));
      root = _resolvePackage(packageName);
    } else if (source === 'path') {
      root = _resolvePath(String(options.path ?? _envRequired('HME_OMO_PATH')));
    } else {
      throw new Error(`unsupported HME_OMO_SOURCE: ${source}`);
    }
    const pkg = _packageJson(root);
    const result = {
      enabled: true,
      source,
      status: 'ok',
      root,
      package: packageName || pkg.name || '',
      version: pkg.version || '',
      commit: _gitCommit(root),
      entrypoint: _detectEntrypoint(root, pkg),
    };
    emitOmo('omo_dependency_resolved', { ...result, root: path.relative(PROJECT_ROOT, root) || '.' }, telemetry);
    return result;
  } catch (err) {
    const result = { enabled: true, source, status: 'error', error: err.message };
    emitOmo('omo_dependency_resolved', result, telemetry);
    if (options.required) throw err;
    return result;
  }
}

module.exports = { resolveOmo, _entryExists };
