// regimeVelocity: sub-beat velocity-space writer (CC11 expression + direct
// substrate write to 'velocity' so direct-p / cross-layer / regime all
// compete on the same slot histories). Spec only.

moduleLifecycle.declare({
  name: 'regimeVelocity',
  subsystem: 'fx',
  deps: ['regimeWriterFactory'],
  provides: ['regimeVelocity'],
  init: (deps) => deps.regimeWriterFactory.create({
    name: 'regimeVelocity',
    cc: 11,
    substrateDim: 'velocity',
    substrateMode: 'write',
    center: 100,
    maxBias: 27,
    coopRange: [4, 10],
    coherentRange: [-10, 10],
    exploringRange: [12, 26],
    evolvingFreqs: [0.27, 0.63, 1.17],
    evolvingAmp: [14, 22],
    elseRange: [-12, 12],
    cooperationProb: 0.30,
    flutterProb: 0.05,
    getChannels: () => {
      const out = [];
      if (Array.isArray(source2)) for (let i = 0; i < source2.length; i++) out.push(source2[i]);
      if (Array.isArray(reflection)) for (let i = 0; i < reflection.length; i++) out.push(reflection[i]);
      if (Array.isArray(bass)) for (let i = 0; i < bass.length; i++) out.push(bass[i]);
      return out;
    },
  }),
});
