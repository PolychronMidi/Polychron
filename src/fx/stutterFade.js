stutterFade = function stutterFade(channels, numStutters = ri(10, 70), duration = tpSec * rf(.2, 1.5)) {
  const CHsToStutter = ri(1, 5);
  const channelsToStutter = new Set();
  const availableCHs = channels.filter(ch => !this.lastUsedCHs.has(ch));

  while (channelsToStutter.size < CHsToStutter && availableCHs.length > 0) {
    const ch = availableCHs[m.floor(m.random() * availableCHs.length)];
    channelsToStutter.add(ch);
    availableCHs.splice(availableCHs.indexOf(ch), 1);
  }

  if (channelsToStutter.size < CHsToStutter) {
    this.lastUsedCHs.clear();
  } else {
    this.lastUsedCHs = new Set(channelsToStutter);
  }

  const channelsArray = Array.from(channelsToStutter);
  channelsArray.forEach(channelToStutter => {
    const maxVol = ri(90, 120);
    const isFadeIn = rf() < 0.5;
    let tick, volume;

    for (let i = m.floor(numStutters * (rf(1/3, 2/3))); i < numStutters; i++) {
      tick = beatStart + i * (duration / numStutters) * rf(.9, 1.1);
      if (isFadeIn) {
        volume = modClamp(m.floor(maxVol * (i / (numStutters - 1))), 25, maxVol);
      } else {
        volume = modClamp(m.floor(100 * (1 - (i / (numStutters - 1)))), 25, 100);
      }
      p(c, { tick: tick, type: 'control_c', vals: [channelToStutter, 7, m.round(volume / rf(1.5, 5))] });
      p(c, { tick: tick + duration * rf(.95, 1.95), type: 'control_c', vals: [channelToStutter, 7, volume] });
    }
    p(c, { tick: tick + duration * rf(.5, 3), type: 'control_c', vals: [channelToStutter, 7, maxVol] });
  });
};
