// regimeFx: sub-beat filter-cutoff (CC74) contention writer. Spec only.

moduleLifecycle.declare({
  name: 'regimeFx',
  subsystem: 'fx',
  deps: ['regimeWriterFactory'],
  provides: ['regimeFx'],
  init: (deps) => deps.regimeWriterFactory.create({
    name: 'regimeFx',
    cc: 74,
    substrateDim: 'filter',
    substrateMode: 'observeControl',
    center: 80,
    maxBias: 48,
    coopRange: [8, 18],
    coherentRange: [-12, 16],
    exploringRange: [22, 46],
    evolvingFreqs: [0.22, 0.55, 0.95],
    evolvingAmp: [20, 38],
    elseRange: [-18, 18],
    cooperationProb: 0.33,
    flutterProb: 0.07,
    getChannels: () => {
      const out = [];
      if (Array.isArray(source2)) for (let i = 0; i < source2.length; i++) out.push(source2[i]);
      if (Array.isArray(reflection)) for (let i = 0; i < reflection.length; i++) out.push(reflection[i]);
      if (Array.isArray(bass)) for (let i = 0; i < bass.length; i++) out.push(bass[i]);
      return out;
    },
  }),
});
