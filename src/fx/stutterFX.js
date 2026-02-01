stutterFX = function stutterFX(channels, numStutters = ri(30, 100), duration = tpSec * rf(.1, 2)) {
  const CHsToStutter = ri(1, 2);
  const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !this.lastUsedCHs2.has(ch));

  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }

  if (channelsToStutter.size < CHsToStutter) {
    this.lastUsedCHs2.clear();
  } else {
    this.lastUsedCHs2 = new Set(channelsToStutter);
  }

  const channelsArray = Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => {
    const startValue = ri(0, 127);
    const endValue = ri(0, 127);
    const ccParam = ra([91, 92, 93, 71, 74]);
    let tick;

    for (let i = m.floor(numStutters * rf(1/3, 2/3)); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
      const progress = i / (numStutters - 1);
      const currentValue = m.floor(startValue + (endValue - startValue) * progress);
      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, ccParam, currentValue] });
    }
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, ccParam, 64] });
  });
};
