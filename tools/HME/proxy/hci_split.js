'use strict';

const PHASES = new Set(['maintenance', 'composition', 'audit', 'exploration', 'repair']);

function normalizePhase(phase) {
  return PHASES.has(phase) ? phase : 'maintenance';
}

function splitScores(input = {}) {
  const phase = normalizePhase(input.phase);
  const verifier = Number.isFinite(input.verifier) ? input.verifier : 1;
  const behavior = Number.isFinite(input.behavior) ? input.behavior : verifier;
  const tooling = Number.isFinite(input.tooling) ? input.tooling : verifier;
  const temporal = Number.isFinite(input.temporal) ? input.temporal : verifier;
  const weights = phase === 'composition'
    ? { verifier: 0.30, behavior: 0.35, tooling: 0.20, temporal: 0.15 }
    : phase === 'maintenance'
      ? { verifier: 0.45, behavior: 0.15, tooling: 0.20, temporal: 0.20 }
      : { verifier: 0.35, behavior: 0.25, tooling: 0.20, temporal: 0.20 };
  const composite = verifier * weights.verifier + behavior * weights.behavior + tooling * weights.tooling + temporal * weights.temporal;
  return { phase, verifier, behavior, tooling, temporal, composite, weights };
}

module.exports = { PHASES, normalizePhase, splitScores };
