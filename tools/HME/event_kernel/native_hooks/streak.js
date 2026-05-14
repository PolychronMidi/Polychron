'use strict';

const {
  PROJECT_ROOT,
  allow,
  fs,
  path,
  runPython,
} = require('./common');

function streakTick(weight) {
  const file = '/tmp/hme-non-hme-streak.score';
  let score = 0;
  try { score = Number(fs.readFileSync(file, 'utf8').trim()) || 0; } catch (_e) { /* missing */ }
  score += weight;
  fs.writeFileSync(file, String(score));
  const block = 70 + (Number(process.env.HME_STREAK_BLOCK_BUMP || 0) || 0);
  const warn = 50 + (Number(process.env.HME_STREAK_BLOCK_BUMP || 0) || 0);
  if (score >= block) {
    return {
      ok: false,
      message: `BLOCKED: Raw tool streak ${score}/${block} (cost: Bash=15, Edit=10, Read=5, Grep=20).\n  Reset now: run \`i/review mode=forget\` or use native Read on the target.`,
    };
  }
  if (score >= warn) {
    return { ok: true, message: `REMINDER: Raw tool streak ${score}/${block}. Prefer HME tools and native Read; Read/Edit are KB-enriched.` };
  }
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
