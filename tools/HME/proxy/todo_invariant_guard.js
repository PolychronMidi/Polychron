'use strict';

const fs = require('fs');
const path = require('path');

const TODO_REL = path.join('doc', 'templates', 'TODO.md');

function _norm(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function _sigWords(text) {
  return new Set(_norm(text).match(/[a-z0-9]{4,}/g) || []);
}

function _parse(text) {
  const lines = String(text || '').split(/\r?\n/);
  let setNumber = null;
  let marker = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^\s*###\s+Todo\s+-\s+Set\s+(\d+)\s*$/i.exec(lines[i]);
    if (m) { setNumber = Number(m[1]); marker = i; break; }
  }
  const active = marker >= 0 ? lines.slice(marker + 1) : lines;
  const todos = [];
  const re = /^\s*#(\d+)\s+(0|1|2|3|4f|4|5)(?:_\d+)?_?\s+(.*?)(?:\s+<!--\s*since:[^>]*-->)?\s*$/;
  for (const line of active) {
    const m = re.exec(line);
    if (!m) continue;
    todos.push({ id: Number(m[1]), code: m[2], text: (m[3] || '').replace(/\s+_q="[^"]*"\s*$/, '').trim() });
  }
  return { setNumber, todos };
}

function _rank(code) {
  return { 0: 0, 1: 1, 2: 2, 3: 3, 4: 4, '4f': 5, 5: 6 }[code] || 0;
}

function _todoPath(root) {
  return path.join(root, TODO_REL);
}

function _readTodo(root) {
  try { return fs.readFileSync(_todoPath(root), 'utf8'); }
  catch (_e) { return ''; }
}

function _archiveTexts(root, preferredSet = null) {
  const out = new Set();
  const dir = path.join(root, 'log', 'todo');
  const files = [];
  if (preferredSet != null) files.push(path.join(dir, `set${preferredSet}.md`));
  try {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (ent.isFile() && /^set\d+\.md$/.test(ent.name)) files.push(path.join(dir, ent.name));
    }
  } catch (_e) { return out; }
  for (const file of files) {
    try {
      for (const t of _parse(fs.readFileSync(file, 'utf8')).todos) out.add(_norm(t.text));
    } catch (_e) { /* silent-ok: best-effort archive scan */ }
  }
  return out;
}

function _survives(todo, afterTodos, archived) {
  const nt = _norm(todo.text);
  if (afterTodos.some((t) => _norm(t.text) === nt)) return true;
  if (archived.has(nt)) return true;
  const same = afterTodos.find((t) => t.id === todo.id);
  if (!same) return false;
  const bw = _sigWords(todo.text);
  const aw = _sigWords(same.text);
  if (!bw.size || !aw.size) return false;
  let hit = 0;
  for (const w of bw) if (aw.has(w)) hit += 1;
  return hit / bw.size >= 1 / 3;
}

function projectedTodoText(payload, root) {
  const input = payload.tool_input || {};
  const current = _readTodo(root);
  if (payload.tool_name === 'Write') return String(input.content || '');
  if (payload.tool_name === 'Edit') {
    const oldString = input.old_string;
    const newString = input.new_string;
    if (typeof oldString !== 'string' || typeof newString !== 'string') return null;
    const replaceAll = input.replace_all === true || input.replaceAll === true;
    if (!current.includes(oldString)) return null;
    return replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, newString);
  }
  return null;
}

function todoWriteDecision(payload = {}, root) {
  const input = payload.tool_input || {};
  const file = String(input.file_path || input.path || '');
  if (!file) return null;
  const rel = path.relative(root, path.resolve(root, file));
  if (rel !== TODO_REL) return null;
  const beforeText = _readTodo(root);
  if (!beforeText.trim()) return null;
  const afterText = projectedTodoText(payload, root);
  if (afterText == null) return null;
  const before = _parse(beforeText);
  const after = _parse(afterText);
  if (before.todos.length && before.todos.every((t) => _rank(t.code) >= 3) && after.todos.length === 0) {
    if (before.setNumber == null || after.setNumber !== before.setNumber + 1) {
      return { permissionDecision: 'deny', reason: `BLOCKED: TODO archival must use canonical todo_engine.maybe_archive(): Set ${before.setNumber || '?'} should advance to Set ${(before.setNumber || 0) + 1}, not manual header/delete edits.` };
    }
  }
  const archived = _archiveTexts(root, before.setNumber);
  const lost = before.todos.filter((t) => t.code !== '5' && !_survives(t, after.todos, archived));
  if (lost.length) {
    const detail = lost.slice(0, 3).map((t) => `#${t.id} ${t.code}_ ${t.text}`).join(' | ');
    return { permissionDecision: 'deny', reason: `BLOCKED: unfinished TODO deletion from doc/templates/TODO.md: ${detail}. Mark it 5_/3_ with evidence or archive via canonical todo_engine; never drop non-5_ items manually.` };
  }
  return null;
}

function _commandTouchesTodo(cmd) {
  return /doc\/templates\/TODO\.md|doc\/templates\/TODO\.md|TODO\.md/.test(String(cmd || ''));
}

function bashTodoDecision(command = '') {
  const cmd = String(command || '');
  if (!_commandTouchesTodo(cmd)) return null;
  if (/todo_engine/.test(cmd) && /maybe_archive/.test(cmd)) return null;
  if (/\b(sed|perl|python3?|node|ruby|awk|truncate|tee|cat|cp|mv|rm)\b/.test(cmd) && /(>|-i\b|write_text|open\(|fs\.writeFile|truncate|tee|cp\b|mv\b|rm\b)/.test(cmd)) {
    return { decision: 'deny', reason: 'BLOCKED: Bash mutates doc/templates/TODO.md outside the canonical TODO engine. Use Edit/Write with preflight or todo_engine.store.maybe_archive(); no shell-side TODO rewrites.' };
  }
  return null;
}

module.exports = { TODO_REL, projectedTodoText, todoWriteDecision, bashTodoDecision, _parse };
