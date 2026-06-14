'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROJECT_ROOT = process.env.PROJECT_ROOT || process.cwd();
const MARKER = 'hme_read_chain';

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_e) { return {}; }
}
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.content !== 'undefined') return textOf(value.content);
  }
  return '';
}
function abs(p) { return path.isAbsolute(p) ? p : path.join(PROJECT_ROOT, p); }
function rel(p) { return path.relative(PROJECT_ROOT, abs(p)).replace(/\\/g, '/'); }
function h(s) { return crypto.createHash('sha256').update(s).digest('hex').slice(0, 16); }
function queuePath() { return path.join(PROJECT_ROOT, 'tools', 'HME', 'runtime', 'latest-consult-read-queue.json'); }
function readQueue() {
  try { return JSON.parse(fs.readFileSync(queuePath(), 'utf8')); } catch (_e) { return null; }
}
function writeQueue(q) {
  try { fs.writeFileSync(queuePath(), JSON.stringify(q, null, 2) + '\n'); } catch (_e) {}
}
function transcriptPath(env) {
  return env.transcript_path || env.transcriptPath || process.env.HME_TRANSCRIPT_PATH || '';
}
function appendProof(transcript, file, resultText, queue) {
  if (!transcript) return false;
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const id = `${MARKER}__bridge__${h(rel(file))}`;
  const existing = fs.existsSync(transcript) ? fs.readFileSync(transcript, 'utf8') : '';
  if (existing.includes(id)) return true;
  const now = new Date().toISOString();
  const rows = [
    { type: 'assistant', timestamp: now, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: abs(file) } }] }, hme_read_chain_bridge: { source: 'posttooluse_read', round: queue.round || null } },
    { type: 'user', timestamp: now, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: resultText }] }, hme_read_chain_bridge: { source: 'posttooluse_read', native_read_file: abs(file) } },
  ];
  fs.appendFileSync(transcript, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return true;
}
function main() {
  const env = readStdin();
  const input = env.tool_input || {};
  const file = input.file_path || input.path || '';
  if (!file) return;
  const resp = env.tool_response || env.tool_result || {};
  if (resp && resp.is_error === true) return;
  const q = readQueue();
  const needed = q && Array.isArray(q.native_read_before_report) ? q.native_read_before_report.map(rel) : [];
  if (!needed.includes(rel(file))) return;
  const ok = appendProof(transcriptPath(env), file, textOf(resp), q || {});
  if (!ok) return;
  const proved = new Set(Array.isArray(q.proved_native_reads) ? q.proved_native_reads.map(String) : []);
  proved.add(rel(file));
  writeQueue({ ...q, proved_native_reads: [...proved].sort(), last_proved_at: new Date().toISOString(), proof_bridge: 'posttooluse_read_transcript' });
}
if (require.main === module) main();
module.exports = { appendProof, rel };
