'use strict';
const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const {
  isMisplacedRootOnlyDir,
  isMisplacedMetricsPath,
  rootOnlyDirMessage,
  metricsMessage,
} = require('./path_policy');

function permission(decision, reason = '') {
  return { permissionDecision: decision, reason, contextualRules: [] };
}

function badPathShape(file) {
  const s = String(file == null ? '' : file);
  return !s.trim() || /[\r\n]/.test(s) || s.trim().startsWith('<<') || /HME_CODEX_JSON|[{}]/.test(s);
}

function patchText(input = {}) {
  return String(input.patchText == null ? (input.patch_text == null ? (input.patch == null ? (input.diff == null ? '' : input.diff) : input.patch) : input.patch_text) : input.patchText);
}

function isApplyPatchPayload(payload = {}) {
  const tool = String(payload.tool_name || '');
  const input = payload.tool_input || {};
  return tool === 'ApplyPatch' || tool === 'apply_patch' || (tool === 'Edit' && Object.prototype.hasOwnProperty.call(input, 'patchText'));
}

function cleanPath(raw) {
  return String(raw || '').trim().replace(/^["']+|["']+$/g, '');
}

function resolvePatchPath(raw) {
  const cleaned = cleanPath(raw);
  if (badPathShape(cleaned)) throw new Error('malformed apply_patch file path: ' + (cleaned || '(empty)'));
  const abs = path.resolve(PROJECT_ROOT, cleaned);
  const rel = path.relative(PROJECT_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('apply_patch path outside PROJECT_ROOT: ' + cleaned);
  return abs;
}

function pushSection(sections, current) {
  if (current) sections.push(current);
}

function parseSections(text) {
  if (!/^\*\*\* Begin Patch\s*$/m.test(text) || !/^\*\*\* End Patch\s*$/m.test(text)) {
    throw new Error('malformed apply_patch: missing Begin/End Patch');
  }
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\*\*\* (Add File|Update File|Delete File):\s+(.+)$/.exec(line);
    if (header) {
      pushSection(sections, current);
      current = { kind: header[1], file: header[2], moveTo: '', added: [], removed: [] };
      continue;
    }
    if (/^\*\*\* End Patch\s*$/.test(line)) {
      pushSection(sections, current);
      current = null;
      continue;
    }
    if (!current) continue;
    const move = /^\*\*\* Move to:\s+(.+)$/.exec(line);
    if (move) {
      current.moveTo = move[1];
      continue;
    }
    if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return sections;
}

function rel(abs) {
  return path.relative(PROJECT_ROOT, abs) || '.';
}

function credentialDecision(file) {
  const base = path.basename(file || '');
  return /^(id_rsa|id_ed25519|id_ecdsa|id_dsa)(\.pub)?$|\.(pem|key|pfx|p12|jks)$|^credentials(\.json)?$|^service[-_]account.*\.json$|^\.npmrc$|^\.pypirc$|^\.netrc$/i.test(base)
    ? permission('deny', 'BLOCKED: apply_patch targets a credential filename (' + base + ').')
    : null;
}

function pathDecision(abs, verb) {
  if (fs.existsSync(path.join(PROJECT_ROOT, 'tmp', 'run.lock')) && rel(abs).startsWith('src/')) {
    return permission('deny', 'ABANDONED PIPELINE: npm run main is running. Do NOT ' + verb.toLowerCase() + ' src/ code mid-pipeline.');
  }
  if (isMisplacedRootOnlyDir(abs, ['log', 'tmp'])) return permission('deny', rootOnlyDirMessage(verb.toLowerCase()));
  if (isMisplacedMetricsPath(abs)) return permission('deny', metricsMessage('write files in', abs));
  return credentialDecision(abs);
}

function contentDecision(abs, content) {
  if (/(api[_-]?key|password|secret|token)[\s]*[:=][\s]*[A-Za-z0-9+/]{20,}/i.test(content)) {
    return permission('deny', 'BLOCKED: apply_patch adds potential secret/credential content in ' + rel(abs) + '.');
  }
  if (rel(abs).startsWith('src/')) {
    if (/\bglobalThis\.|(^|[^a-zA-Z_])global\.[a-zA-Z_]/.test(content)) return permission('deny', 'BLOCKED: apply_patch content uses global. or globalThis.');
    if (/\|\|\s*(0|\[\]|\{})([^a-zA-Z0-9_]|$)/.test(content)) return permission('deny', 'BLOCKED: apply_patch content uses || fallback.');
  }
  return null;
}

function sectionDecision(section) {
  const source = resolvePatchPath(section.file);
  const target = section.moveTo ? resolvePatchPath(section.moveTo) : source;
  const pathCheck = pathDecision(target, section.kind === 'Add File' ? 'Write' : 'Edit');
  if (pathCheck) return pathCheck;
  if (section.kind === 'Add File' && fs.existsSync(target)) return permission('deny', 'BLOCKED: apply_patch Add File target already exists: ' + rel(target));
  if ((section.kind === 'Update File' || section.kind === 'Delete File') && !fs.existsSync(source)) return permission('deny', 'BLOCKED: apply_patch ' + section.kind + ' target missing: ' + rel(source));
  if (section.moveTo && fs.existsSync(target)) return permission('deny', 'BLOCKED: apply_patch Move target already exists: ' + rel(target));
  return contentDecision(target, section.added.join('\n'));
}

function applyPatchDecision(payload = {}) {
  if (!isApplyPatchPayload(payload)) return null;
  const text = patchText(payload.tool_input || {});
  if (!text.trim()) return permission('deny', 'BLOCKED: malformed apply_patch missing patchText.');
  let sections;
  try { sections = parseSections(text); }
  catch (err) { return permission('deny', 'BLOCKED: ' + err.message); }
  if (!sections.length) return permission('deny', 'BLOCKED: malformed apply_patch contains no file sections.');
  for (const section of sections) {
    let decision;
    try { decision = sectionDecision(section); }
    catch (err) { return permission('deny', 'BLOCKED: ' + err.message); }
    if (decision) return decision;
  }
  return permission('allow');
}

module.exports = { applyPatchDecision, parseSections, isApplyPatchPayload };

