'use strict';
const path = require('path');
const { PROJECT_ROOT, hasMisplacedRootOnlyDir } = require('./shared');

const STOP_TOKENS = new Set(['&&', '||', ';', '|']);

function _expandProjectRoot(s, root = PROJECT_ROOT) {
  return String(s || '')
    .replace(/\$\{PROJECT_ROOT\}/g, root)
    .replace(/\$PROJECT_ROOT/g, root);
}

function normalizeTarget(filePath, root = PROJECT_ROOT) {
  const expanded = _expandProjectRoot(filePath, root);
  if (!expanded) return '';
  return path.isAbsolute(expanded) ? path.normalize(expanded) : path.join(root, expanded);
}

function _segments(fullPath) {
  return path.normalize(fullPath).split(path.sep).filter(Boolean);
}

function _isUnder(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

function isMisplacedMetricsPath(filePath, root = PROJECT_ROOT) {
  const full = normalizeTarget(filePath, root);
  if (!full) return false;
  if (!_segments(full).includes('metrics')) return false;
  return !_isUnder(full, path.join(root, 'src', 'output', 'metrics'));
}

function _tokens(cmd) {
  const out = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(cmd || '')))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

function mkdirTargets(cmd) {
  const targets = [];
  let capture = false;
  for (const token of _tokens(cmd)) {
    if (token === 'mkdir' || token.endsWith('/mkdir')) {
      capture = true;
      continue;
    }
    if (!capture) continue;
    if (STOP_TOKENS.has(token)) {
      capture = false;
      continue;
    }
    if (token.startsWith('-')) continue;
    targets.push(token);
  }
  return targets;
}

function hasMkdir(cmd) {
  return /\bmkdir\b/.test(String(cmd || ''));
}

function mkdirHasMisplacedRootOnlyDir(cmd, names, root = PROJECT_ROOT) {
  if (!hasMkdir(cmd)) return false;
  return mkdirTargets(cmd).some((target) => hasMisplacedRootOnlyDir(normalizeTarget(target, root), names, root));
}

function mkdirHasMisplacedMetrics(cmd, root = PROJECT_ROOT) {
  if (!hasMkdir(cmd)) return false;
  return mkdirTargets(cmd).some((target) => isMisplacedMetricsPath(target, root));
}

function rootOnlyDirMessage(verb, root = PROJECT_ROOT, extra = '') {
  const suffix = extra ? ` ${extra}` : '';
  return `BLOCKED: log/ and tmp/ only exist at project root. Do not ${verb} files inside subdirectory variants. Route output through $PROJECT_ROOT/{log,tmp}/.${suffix}`;
}

function metricsMessage(verb, filePath = '') {
  const suffix = filePath ? ` Path: ${filePath}` : '';
  return `BLOCKED: metrics/ only exists at src/output/metrics/. Do not ${verb} any other metrics/ directory.${suffix}`;
}

module.exports = {
  normalizeTarget,
  isMisplacedRootOnlyDir: hasMisplacedRootOnlyDir,
  isMisplacedMetricsPath,
  mkdirTargets,
  hasMkdir,
  mkdirHasMisplacedRootOnlyDir,
  mkdirHasMisplacedMetrics,
  rootOnlyDirMessage,
  metricsMessage,
};
