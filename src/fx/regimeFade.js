// regimeFade: sub-beat volume (CC7) contention writer; restricted to center
// + drum channels (binaural-reserved channels off-limits). Spec only.

moduleLifecycle.declare({
  name: 'regimeFade',
  subsystem: 'fx',
  deps: ['regimeWriterFactory'],
  provides: ['regimeFade'],
  init: (deps) => deps.regimeWriterFactory.create({
    name: 'regimeFade',
    cc: 7,
    substrateDim: 'fade',
    substrateMode: 'observeControl',
    center: 100,
    maxBias: 27,
    coopRange: [5, 12],
    coherentRange: [-8, 8],
    exploringRange: [10, 25],
    evolvingFreqs: [0.25, 0.6, 1.1],
    evolvingAmp: [12, 22],
    elseRange: [-10, 10],
    cooperationProb: 0.40,
    flutterProb: 0.05,
    getChannels: () => [cCH1, cCH2, drumCH, cCH3],
  }),
});
