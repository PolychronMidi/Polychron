'use strict';

const {
  PROJECT_ROOT,
  allow,
  fs,
  path,
  runPython,
} = require('./common');
const { thresholds } = require('./raw_streak_policy');

function streakTick(weight) {
  const file = '/tmp/hme-non-hme-streak.score';
  let score = 0;
  try { score = Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch (_e) { /* missing */ }
  score += weight;
  fs.writeFileSync(file, String(score));
  thresholds();
  return { ok: true, message: '' };
}

function runVow(args = []) {
  const script = path.join(PROJECT_ROOT, 'tools', 'HME', 'scripts', 'vow_bounded_reads.py');
  if (!fs.existsSync(script)) return allow();
  const r = runPython([script, ...args], '', 10_000, 'bounded-reads-vow');
  return { stdout: r.stdout || '', stderr: r.stderr || ' ', exit_code: r.exit_code || 0 };
}

async function pretoolGlob() {
  const st = streakTick(10);
  if (!st.ok) return { stdout: '', stderr: st.message, exit_code: 1 };
  const vow = runVow();
  if (vow.exit_code !== 0) return vow;
  return allow('', st.message || ' ');
}

module.exports = { pretoolGlob, runVow, streakTick };
