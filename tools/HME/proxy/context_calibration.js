'use strict';

// Estimator calibration feedback loop. The token estimator guesses bytes/token
// with fixed priors; real tokenizers differ per content type, so the estimate

const fs = require('fs');
const path = require('path');
const { PROJECT_ROOT } = require('./shared');
const { resolveFactors } = require('./context_token_estimate');

const REL = path.join('tools', 'HME', 'runtime', 'estimator-calibration.json');
const MAX_SAMPLES = 300;
const MIN_SAMPLES_TO_FIT = 24;
// Sane bytes/token bounds: English prose ~4, dense JSON/tool output can reach
// ~1.5; reject fits outside this as ill-conditioned noise.
const MIN_BYTES_PER_TOK = 1.0;
const MAX_BYTES_PER_TOK = 8.0;
// Ignore tiny turns: too little signal, and they skew the fit toward framing
// overhead rather than content density.
const MIN_ACTUAL_TOKENS = 1000;

function calibrationPath(projectRoot = PROJECT_ROOT) {
  return path.join(projectRoot || process.cwd(), REL);
}

function _clamp(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_BYTES_PER_TOK, Math.max(MIN_BYTES_PER_TOK, n));
}

// Pure least-squares fit of actual_tokens ~= reg*x + tr*y (x,y = tokens/byte),
// then invert to bytes/token. Falls back to `priors` when there is too little
function fitFactors(samples, priors) {
  const rows = (samples || []).filter(
    (s) => s && Number.isFinite(s.reg) && Number.isFinite(s.tr) && Number.isFinite(s.actual)
      && s.actual >= MIN_ACTUAL_TOKENS && (s.reg + s.tr) > 0,
  );
  if (rows.length < MIN_SAMPLES_TO_FIT) {
    return { perTok: priors.perTok, toolResultPerTok: priors.toolResultPerTok, samples: rows.length, fitted: false };
  }
  let Srr = 0;
  let Srt = 0;
  let Stt = 0;
  let Sra = 0;
  let Sta = 0;
  for (const s of rows) {
    Srr += s.reg * s.reg;
    Srt += s.reg * s.tr;
    Stt += s.tr * s.tr;
    Sra += s.reg * s.actual;
    Sta += s.tr * s.actual;
  }
  const det = Srr * Stt - Srt * Srt;
  // Relative conditioning guard: a near-singular system means the two buckets
  // are collinear in this window (can't separate them) -> keep priors.
  const scale = Srr * Stt;
  if (!(scale > 0) || Math.abs(det) < 1e-6 * scale) {
    return { perTok: priors.perTok, toolResultPerTok: priors.toolResultPerTok, samples: rows.length, fitted: false };
  }
  const x = (Sra * Stt - Sta * Srt) / det;
  const y = (Srr * Sta - Srt * Sra) / det;
  const perTok = _clamp(x > 0 ? 1 / x : 0);
  const toolResultPerTok = _clamp(y > 0 ? 1 / y : 0);
  // If either bucket inverted to an out-of-range / non-positive ratio, the fit
  // is untrustworthy for that bucket; keep the corresponding prior.
  return {
    perTok: perTok || priors.perTok,
    toolResultPerTok: toolResultPerTok || priors.toolResultPerTok,
    samples: rows.length,
    fitted: Boolean(perTok && toolResultPerTok),
  };
}

let _cache = { mtimeMs: -1, data: null };

function loadCalibration(projectRoot = PROJECT_ROOT) {
  const file = calibrationPath(projectRoot);
  let stat;
  try { stat = fs.statSync(file); }
  catch (_e) { _cache = { mtimeMs: -1, data: null }; return null; }
  if (_cache.data && stat.mtimeMs === _cache.mtimeMs) return _cache.data;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    _cache = { mtimeMs: stat.mtimeMs, data };
    return data;
  } catch (_e) {
    return null;
  }
}

function _enabled(env) {
  return String((env || process.env).HME_PROXY_ESTIMATOR_CALIBRATION || '') === '1';
}

// Effective factors for the estimator: persisted fit when available AND the
// feedback loop is enabled, else the env priors. The flag gate keeps the
function calibratedFactors(env = process.env, projectRoot = PROJECT_ROOT) {
  const priors = resolveFactors(env, null);
  if (!_enabled(env)) return priors;
  const data = loadCalibration(projectRoot);
  if (data && data.factors && data.factors.fitted) {
    return { perTok: data.factors.perTok, toolResultPerTok: data.factors.toolResultPerTok };
  }
  return priors;
}

// Record one ground-truth sample and re-fit. Best-effort: any failure is
// swallowed (calibration is an optimization, never on the request critical path).
function recordSample({ reg, tr, actual, env = process.env, projectRoot = PROJECT_ROOT } = {}) {
  if (!_enabled(env)) return null;
  if (!Number.isFinite(reg) || !Number.isFinite(tr) || !Number.isFinite(actual)) return null;
  if (actual < MIN_ACTUAL_TOKENS || (reg + tr) <= 0) return null;
  try {
    const file = calibrationPath(projectRoot);
    let data = loadCalibration(projectRoot) || { samples: [], factors: null };
    const samples = Array.isArray(data.samples) ? data.samples.slice() : [];
    samples.push({ reg: Math.round(reg), tr: Math.round(tr), actual: Math.round(actual) });
    while (samples.length > MAX_SAMPLES) samples.shift();
    const priors = resolveFactors(env, null);
    const factors = fitFactors(samples, priors);
    const next = { samples, factors, updated: new Date().toISOString() };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next));
    fs.renameSync(tmp, file);
    _cache = { mtimeMs: -1, data: null };
    return factors;
  } catch (_e) {
    return null;
  }
}

module.exports = {
  calibrationPath,
  fitFactors,
  loadCalibration,
  calibratedFactors,
  recordSample,
  MIN_SAMPLES_TO_FIT,
};
