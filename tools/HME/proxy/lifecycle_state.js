'use strict';

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');

function resolveRelative(rel) {
  return path.join(PROJECT_ROOT, rel);
}

function readJson(rel, fallback = null) {
  const file = resolveRelative(rel);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    return fallback;
  }
}

function readText(rel, fallback = '') {
  const file = resolveRelative(rel);
  try { return fs.readFileSync(file, 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return fallback;
    return fallback;
  }
}

function writeAtomic(rel, contents) {
  const file = resolveRelative(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
  return file;
}

function writeJsonAtomic(rel, value) {
  return writeAtomic(rel, JSON.stringify(value, null, 2) + '\n');
}

function remove(rel) {
  const file = resolveRelative(rel);
  try { fs.unlinkSync(file); return true; }
  catch (err) {
    if (err && err.code === 'ENOENT') return false;
    throw err;
  }
}

function mtimeMs(rel) {
  const file = resolveRelative(rel);
  try { return fs.statSync(file).mtimeMs; }
  catch (_e) { return 0; }
}

const MARKERS = Object.freeze({
  PROXY_RUNTIME: 'tools/HME/runtime/proxy-runtime.json',
  SUPERVISOR_STATE: 'tools/HME/runtime/proxy-supervisor-state.json',
  RELOAD_NEEDED: 'tools/HME/runtime/post-commit-proxy-reload-needed',
  STALE_RUNTIME: 'tools/HME/runtime/post-commit-stale-runtime.json',
  ROUTE_HEALTH: 'tools/HME/runtime/model-route-health.json',
});

function readMarker(name) {
  const rel = MARKERS[name];
  if (!rel) throw new Error(`unknown lifecycle marker: ${name}`);
  if (rel.endsWith('.json')) return readJson(rel, null);
  return readText(rel, '');
}

function writeMarker(name, value) {
  const rel = MARKERS[name];
  if (!rel) throw new Error(`unknown lifecycle marker: ${name}`);
  if (rel.endsWith('.json')) return writeJsonAtomic(rel, value);
  return writeAtomic(rel, typeof value === 'string' ? value : String(value));
}

function clearMarker(name) {
  const rel = MARKERS[name];
  if (!rel) throw new Error(`unknown lifecycle marker: ${name}`);
  return remove(rel);
}

function markerMtimeMs(name) {
  const rel = MARKERS[name];
  if (!rel) throw new Error(`unknown lifecycle marker: ${name}`);
  return mtimeMs(rel);
}

module.exports = {
  MARKERS,
  readJson,
  readText,
  writeAtomic,
  writeJsonAtomic,
  remove,
  mtimeMs,
  readMarker,
  writeMarker,
  clearMarker,
  markerMtimeMs,
};
