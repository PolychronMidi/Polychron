'use strict';

const { hasSameTurnEvidence } = require('../context');

const detectorVerdictCheck = {
  name: 'detector-verdicts',
  evaluate(state) {
    if (state.firing.some((f) => f.name === 'CLAIM_WITHOUT_EVIDENCE')
      && hasSameTurnEvidence(state.lastUserInfo.tsMs)) {
      state.firing = state.firing.filter((f) => f.name !== 'CLAIM_WITHOUT_EVIDENCE');
    }
    if (state.firing.length === 1) return state.deny(state.firing[0].name, state.firing[0].reason);
    if (state.firing.length <= 1) return null;
    const names = state.firing.map((f) => f.name).join(', ');
    const header = `MULTI-FLAG STOP (${state.firing.length} detectors firing): ${names}.\nAddress all of them in this turn.\n\n`;
    const body = state.firing.map((f, i) => `--- [${i + 1}/${state.firing.length}] ${f.name} ---\n${f.reason}`).join('\n\n');
    return state.deny('MULTI_FLAG', header + body);
  },
};

module.exports = { detectorVerdictCheck };
