// regimePan: sub-beat pan (CC10) contention writer. Spec only; tick/flutter
// /cooperation/regime-branch logic lives in regimeWriterFactory.

moduleLifecycle.declare({
  name: 'regimePan',
  subsystem: 'fx',
  deps: ['regimeWriterFactory'],
  provides: ['regimePan'],
  init: (deps) => deps.regimeWriterFactory.create({
    name: 'regimePan',
    cc: 10,
    substrateDim: 'pan',
    substrateMode: 'observeControl',
    center: 64,
    maxBias: 48,
    coopRange: [6, 16],
    coherentRange: [-18, 18],
    exploringRange: [18, 44],
    evolvingFreqs: [0.3, 0.7, 1.3],
    evolvingAmp: [18, 34],
    elseRange: [-20, 20],
    cooperationProb: 0.30,
    flutterProb: 0.05,
    getChannels: () => {
      const out = [];
      if (Array.isArray(source2)) for (let i = 0; i < source2.length; i++) out.push(source2[i]);
      if (Array.isArray(reflection)) for (let i = 0; i < reflection.length; i++) out.push(reflection[i]);
      if (Array.isArray(bass)) for (let i = 0; i < bass.length; i++) out.push(bass[i]);
      return out;
    },
    includeApplyAlias: true,
  }),
});
