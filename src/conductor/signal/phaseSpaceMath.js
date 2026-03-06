// phaseSpaceMath.js - Pure vector/matrix math for phase-space trajectory analysis.
// Extracted from systemDynamicsProfiler.js. Stateless functions with zero
// internal state - consumed as a global helper by systemDynamicsProfiler.

phaseSpaceMath = (() => {
  /**
   * Euclidean magnitude of a vector.
   * @param {number[]} v
   * @returns {number}
   */
  function magnitude(v) {
    let sum = 0;
    for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
    return m.sqrt(sum);
  }

  /**
   * Cosine similarity between two vectors. Returns 0 for degenerate inputs.
   * @param {number[]} a
   * @param {number[]} b
   * @returns {number} [-1, 1]
   */
  function cosine(a, b) {
    let dot = 0;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      ma += a[i] * a[i];
      mb += b[i] * b[i];
    }
    const denom = m.sqrt(ma) * m.sqrt(mb);
    if (denom < 1e-10) return 0;
    return clamp(dot / denom, -1, 1);
  }

  /**
   * Rolling mean & variance per dimension over a trajectory window.
   * @param {Array<number[]>} data - N*D trajectory points
   * @param {number} nDims - total dimensions to compute over
   * @returns {{ mean: number[], variance: number[] }}
   */
  function stats(data, nDims) {
    const n = data.length;
    const mean = new Array(nDims).fill(0);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < nDims; d++) mean[d] += data[i][d];
    }
    for (let d = 0; d < nDims; d++) mean[d] /= n;

    const variance = new Array(nDims).fill(0);
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < nDims; d++) {
        const diff = data[i][d] - mean[d];
        variance[d] += diff * diff;
      }
    }
    for (let d = 0; d < nDims; d++) variance[d] /= n;

    return { mean, variance };
  }

  /**
   * Cross-coupling: rolling correlation matrix between dimension pairs.
   * Returns upper triangle as { 'density-tension': 0.85, ... } plus mean
   * absolute correlation over compositional pairs only.
   * @param {Array<number[]>} data - N*D trajectory
   * @param {number[]} mean - per-dimension means
   * @param {string[]} dimNames - dimension labels
   * @param {number} nDims - total dimensions
   * @param {number} nCompositional - number of compositional dims (strength uses only these)
   * @returns {{ matrix: Record<string, number>, strength: number }}
   */
  function coupling(data, mean, dimNames, nDims, nCompositional) {
    const n = data.length;
    /** @type {Record<string, number>} */
    const matrix = {};
    let totalAbs = 0;
    let pairCount = 0;

    for (let a = 0; a < nDims; a++) {
      for (let b = a + 1; b < nDims; b++) {
        // Skip trust-phase: both are structurally monotonic within sections
        // (trust ramps via EMA, phase = normalizedProgress). Their correlation
        // is a mathematical artifact, not actionable, and inflates metrics.
        if ((dimNames[a] === 'trust' && dimNames[b] === 'phase') ||
            (dimNames[a] === 'phase' && dimNames[b] === 'trust')) continue;
        const key = dimNames[a] + '-' + dimNames[b];
        let covAB = 0;
        let varA = 0;
        let varB = 0;
        for (let i = 0; i < n; i++) {
          const da = data[i][a] - mean[a];
          const db = data[i][b] - mean[b];
          covAB += da * db;
          varA += da * da;
          varB += db * db;
        }
        // Variance gating: skip pairs where either dimension has near-zero
        // variance (std < 0.005). Correlation is statistically meaningless
        // and inflates coupling metrics, triggering aggressive nudges that
        // further compress the flat signal (death spiral).
        const stdA = m.sqrt(varA / n);
        const stdB = m.sqrt(varB / n);
        if (stdA < 0.005 || stdB < 0.005) {
          matrix[key] = NaN;
          continue;
        }
        const denom = m.sqrt(varA * varB);
        const corr = denom > 1e-10 ? covAB / denom : NaN;
        matrix[key] = !Number.isNaN(corr) ? m.round(corr * 1000) / 1000 : NaN;
        if (!Number.isNaN(corr) && a < nCompositional && b < nCompositional) {
          totalAbs += m.abs(corr);
          pairCount++;
        }
      }
    }

    return { matrix, strength: pairCount > 0 ? totalAbs / pairCount : 0 };
  }

  /**
   * Jacobi eigenvalue algorithm for a small symmetric matrix.
   * Returns eigenvalues (unsorted). Mutates the input matrix.
   * For K=4, converges in < 10 sweeps.
   * @param {number[][]} A - K*K symmetric matrix (mutated)
   * @param {number} K
   * @returns {number[]} eigenvalues
   */
  function jacobiEigenvalues(A, K) {
    const MAX_SWEEPS = 20;
    for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
      let maxVal = 0;
      let p = 0;
      let q = 1;
      for (let i = 0; i < K; i++) {
        for (let j = i + 1; j < K; j++) {
          if (m.abs(A[i][j]) > maxVal) {
            maxVal = m.abs(A[i][j]);
            p = i;
            q = j;
          }
        }
      }
      if (maxVal < 1e-10) break;

      const diff = A[q][q] - A[p][p];
      const t = m.abs(diff) < 1e-12
        ? 1.0
        : (2.0 * A[p][q]) / (diff + m.sign(diff) * m.sqrt(diff * diff + 4 * A[p][q] * A[p][q]));
      const c = 1.0 / m.sqrt(1 + t * t);
      const s = t * c;

      const app = A[p][p];
      const aqq = A[q][q];
      const apq = A[p][q];
      A[p][p] = c * c * app - 2 * s * c * apq + s * s * aqq;
      A[q][q] = s * s * app + 2 * s * c * apq + c * c * aqq;
      A[p][q] = 0;
      A[q][p] = 0;

      for (let r = 0; r < K; r++) {
        if (r === p || r === q) continue;
        const arp = A[r][p];
        const arq = A[r][q];
        A[r][p] = c * arp - s * arq;
        A[p][r] = A[r][p];
        A[r][q] = s * arp + c * arq;
        A[q][r] = A[r][q];
      }
    }
    const eigenvalues = new Array(K);
    for (let i = 0; i < K; i++) eigenvalues[i] = A[i][i];
    return eigenvalues;
  }

  /**
   * Effective dimensionality from eigenvalues of the compositional correlation
   * matrix. Result: exp(Shannon entropy of normalized eigenvalues).
   * @param {Array<number[]>} data - raw trajectory (N*D)
   * @param {number[]} mean - per-dimension means
   * @param {number} nCompositional - compositional dimension count
   * @returns {number} 1.0 to nCompositional
   */
  function effectiveDimensionality(data, mean, nCompositional) {
    const n = data.length;
    if (n < 3) return 1;
    const K = nCompositional;

    // Build K*K correlation matrix from compositional dims only
    const R = new Array(K);
    for (let i = 0; i < K; i++) R[i] = new Array(K).fill(0);

    const varAcc = new Array(K).fill(0);
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < K; i++) {
        const di = data[s][i] - mean[i];
        varAcc[i] += di * di;
        for (let j = i; j < K; j++) {
          R[i][j] += di * (data[s][j] - mean[j]);
        }
      }
    }
    for (let i = 0; i < K; i++) {
      for (let j = i; j < K; j++) {
        if (i === j) { R[i][j] = 1.0; continue; }
        const denom = m.sqrt(varAcc[i] * varAcc[j]);
        const r = denom > 1e-10 ? R[i][j] / denom : 0;
        R[i][j] = r;
        R[j][i] = r;
      }
    }

    const eigenvalues = jacobiEigenvalues(R, K);

    let total = 0;
    for (let i = 0; i < K; i++) total += m.max(eigenvalues[i], 0);
    if (total < 1e-12) return 1;

    let H = 0;
    for (let i = 0; i < K; i++) {
      const p = m.max(eigenvalues[i], 0) / total;
      if (p > 1e-12) H -= p * m.log(p);
    }
    return clamp(m.exp(H), 1, K);
  }

  return { magnitude, cosine, stats, coupling, jacobiEigenvalues, effectiveDimensionality };
})();
