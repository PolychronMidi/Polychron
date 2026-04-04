// grandFinale.js - Finalize and write out all layer buffers to CSV files

const V = validator.create('grandFinale');

function grandFinaleResolveType(event) {
  return event.type === 'on' ? 'note_on_c' : (event.type ? event.type : 'note_off_c');
}

function grandFinaleEventPriority(event) {
  const type = grandFinaleResolveType(event);
  if (type === 'control_c' && Array.isArray(event.vals)) {
    const controlNumber = Number(event.vals[1]);
    if (controlNumber === 64 || controlNumber === 123 || controlNumber === 120) return 0;
    if (controlNumber === 7) return 3;
  }
  if (type === 'note_off_c') return 1;
  if (type === 'pitch_bend_c') return 2;
  if (type === 'note_on_c') return 4;
  return 3;
}

grandFinale = () => {
  if (!LM.layers) throw new Error('grandFinale: LM.layers must be a defined object');
  V.assertObject(LM.layers, 'LM.layers');

  // Schedule binaural shifts over the full track for both layers.
  // Single walk - both layers see each shift at each time step.
  const noteBounds = L0.getBounds('note');
  if (noteBounds && noteBounds.first && noteBounds.last) {
    const trackStart = m.max(0, noteBounds.first.timeInSeconds);
    const trackEnd = noteBounds.last.timeInSeconds;
    firstLoop = 0;
    beatStartTime = trackStart;
    while (beatStartTime <= trackEnd) {
      LM.activeLayer = 'L1';
      c = LM.layers['L1'].buffer;
      setBinaural();
      firstLoop = 1;
      LM.activeLayer = 'L2';
      c = LM.layers['L2'].buffer;
      setBinaural();
      beatStartTime += spBeat > 0 ? spBeat : 0.5;
    }
  }

  // Write L0 audit dump. High-frequency per-note channels are summarized
  // (count + first/last entry) to keep the file small; low-frequency channels
  // are written in full for forensic inspection.
  try {
    const L0_SUMMARY_THRESHOLD = 1000;
    const l0Dump = {};
    const chNames = Object.keys(L0.channels);
    for (let ci = 0; ci < chNames.length; ci++) {
      const ch = chNames[ci];
      const arr = L0.channels[ch];
      if (arr.length > L0_SUMMARY_THRESHOLD) {
        l0Dump[ch] = {
          _summary: true,
          count: arr.length,
          first: arr[0],
          last: arr[arr.length - 1]
        };
      } else {
        l0Dump[ch] = arr;
      }
    }
    fs.mkdirSync('metrics', { recursive: true });
    fs.writeFileSync('metrics/l0-dump.json', JSON.stringify(l0Dump, null, 2));
    console.log('Wrote file: metrics/l0-dump.json');
    // CIM, stutter variant, and correlation shuffler telemetry snapshots
    const runtimeSnap = {
      cim: safePreBoot.call(() => coordinationIndependenceManager.getSnapshot(), null),
      stutterVariants: safePreBoot.call(() => stutterMetrics.getMetrics(), null),
      correlationShuffler: safePreBoot.call(() => correlationShuffler.getSnapshot(), null),
      sectionHistory: safePreBoot.call(() => ({
        tensionTrajectory: sectionMemory.getTensionTrajectory(),
        densityTrajectory: sectionMemory.getDensityTrajectory(),
        perSection: sectionMemory.getHistory()
      }), null)
    };
    fs.writeFileSync('metrics/runtime-snapshots.json', JSON.stringify(runtimeSnap, null, 2));
    console.log('Wrote file: metrics/runtime-snapshots.json');
    // Cross-run adaptive state: save terminal EMA values for next boot warm-start
    // Xenolinguistic L5: cross-run personality persistence
    const lastNarration = safePreBoot.call(() => L0.getLast('self-narration', { layer: 'both' }), null);
    const tensionTraj = safePreBoot.call(() => sectionMemory.getTensionTrajectory(), 0);
    const hmSnap = safePreBoot.call(() => hyperMetaManager.getSnapshot(), null);
    const rcReadiness = safePreBoot.call(() => regimeClassifier.getTransitionReadiness(), null);
    const cimSnap = safePreBoot.call(() => coordinationIndependenceManager.getSnapshot(), null);
    const trustScores = safePreBoot.call(() => adaptiveTrustScores.getScores(), null);
    const adaptiveState = {
      healthEma: hmSnap ? hmSnap.healthEma : 0.7,
      exceedanceTrendEma: hmSnap ? hmSnap.exceedanceTrendEma : 0,
      coherentShareEma: hmSnap ? hmSnap.coherentShareEma : 0.285,
      systemPhase: hmSnap ? hmSnap.systemPhase : 'converging',
      coherentThresholdScale: rcReadiness ? rcReadiness.thresholdScale : 0.65,
      cimDials: cimSnap ? cimSnap.dials : null,
      cimEffectiveness: cimSnap ? cimSnap.effectiveness : null,
      trustScores: trustScores || null,
      // Cross-run personality: what this composition was like
      lastRunPersonality: {
        narrative: lastNarration ? lastNarration.narrative : 'balanced evolving',
        tensionTrajectory: (tensionTraj || 0) > 0.1 ? 'rising' : (tensionTraj || 0) < -0.1 ? 'falling' : 'stable',
        dominantRegime: hmSnap && hmSnap.coherentShareEma > 0.4 ? 'coherent' : 'exploring'
      },
      savedAt: new Date().toISOString()
    };
    fs.writeFileSync('metrics/adaptive-state.json', JSON.stringify(adaptiveState, null, 2));
    console.log('Wrote file: metrics/adaptive-state.json');
  } catch (e) {
    throw new Error('grandFinale: failed to write l0-dump.json: ' + e.message);
  }

  let globalFinalTimeInSeconds = 0;
  const pendingWrites = [];

  const LMCurrent = LM;
  // Collect all layer data
  const layerData = Object.entries(LMCurrent.layers).map(([name, layer]) => {
    if (!layer) throw new Error(`grandFinale: layer "${name}" must be an object`);
    V.assertObject(layer, 'layer');
    return {
      name,
      layer: layer,
      buffer: layer.buffer
    };
  });
  layerData.forEach(({ name, buffer }) => {
    // L0 is an in-memory-only layer; never written to CSV output.
    if (name === 'L0') return;
    // Set naked global buffer `c` to this layer's buffer
    c = buffer;

    // Finalize buffer
    if (!Array.isArray(buffer)) {
      try {
        V.assertObject(buffer, 'buffer');
        V.assertArray(buffer.rows, 'buffer.rows');
      } catch { /* boot-safety: dependency may not be ready */
        throw new Error(`grandFinale: layer "${name}" buffer must be an array or object with rows array`);
      }
      buffer = buffer.rows;
    }
    buffer = buffer.filter(i => i !== null)
      .map((i, index) => {
        if (!i) throw new Error(`grandFinale: layer "${name}" contains non-object event entry`);
        V.assertObject(i, 'i');
        const timeInSeconds = m.max(0, V.requireFinite(Number(i.timeInSeconds), 'timeInSeconds'));
        if (timeInSeconds < -0.001) throw new Error(`grandFinale: event timeInSeconds must be >= 0, received ${timeInSeconds}`);
        return {
          ...i,
          grandFinaleTimeInSeconds: timeInSeconds,
          grandFinalePriority: grandFinaleEventPriority(i),
          grandFinaleStableIndex: index,
        };
      })
      .sort((a, b) => {
        if (a.grandFinaleTimeInSeconds !== b.grandFinaleTimeInSeconds) {
          return a.grandFinaleTimeInSeconds - b.grandFinaleTimeInSeconds;
        }
        if (a.grandFinalePriority !== b.grandFinalePriority) {
          return a.grandFinalePriority - b.grandFinalePriority;
        }
        return a.grandFinaleStableIndex - b.grandFinaleStableIndex;
      });

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTimeInSeconds = -Infinity;

    buffer.forEach(_ => {
      const type = grandFinaleResolveType(_);
      const csvTime = `${_.grandFinaleTimeInSeconds}s`;

      if (Array.isArray(_.vals)) {
        if ((type === 'note_on_c' || type === 'note_off_c') && (_.vals[1] === undefined || _.vals[1] === null)) {
          throw new Error(`${type} event has undefined pitch at ${csvTime}: event=${JSON.stringify(_)}; vals=${JSON.stringify(_.vals)}`);
        }
      } else {
        throw new Error(`${type} event has invalid vals format at ${csvTime}: event=${JSON.stringify(_)}`);
      }

      if (type === 'note_on_c' || type === 'note_off_c') {
        const ch = Number(_.vals[0]);
        const pitch = Number(_.vals[1]);
        V.requireFinite(ch, 'ch');
        if (ch < 0 || ch > 15) {
          throw new Error(`${type} event has invalid channel ${_.vals[0]} at ${csvTime}: event=${JSON.stringify(_)}`);
        }
        V.requireFinite(pitch, 'pitch');
        if (pitch < 0 || pitch > MIDI_MAX_VALUE) {
          throw new Error(`${type} event has invalid pitch ${_.vals[1]} at ${csvTime}: event=${JSON.stringify(_)}`);
        }
        _.vals[0] = m.round(ch);
        _.vals[1] = m.round(pitch);
      }

      if (type === 'note_on_c' && Array.isArray(_.vals) && _.vals.length >= 3) {
        const vel = Number(_.vals[2]);
        V.requireFinite(vel, 'vel');
        if (vel < 0 || vel > MIDI_MAX_VALUE) {
          throw new Error(`note_on_c event has invalid velocity ${_.vals[2]} at ${csvTime}: event=${JSON.stringify(_)}`);
        }
        _.vals[2] = m.round(vel);
      }

      composition += `1,${csvTime},${type},${_.vals.join(',')}\n`;
      finalTimeInSeconds = m.max(finalTimeInSeconds, _.grandFinaleTimeInSeconds);
    });

    V.requireFinite(finalTimeInSeconds, 'finalTimeInSeconds');
    if (finalTimeInSeconds < 0) {
      throw new Error(`grandFinale: layer "${name}" produced no valid events (finalTimeInSeconds=${finalTimeInSeconds})`);
    }
    globalFinalTimeInSeconds = m.max(globalFinalTimeInSeconds, finalTimeInSeconds);
    const outputFilename = name === 'L1' ? 'output/output1.csv' : name === 'L2' ? 'output/output2.csv' : `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    pendingWrites.push({ composition, outputFilename });

  });

  // Write all layers with unified end_track time
  const endTrackTime = `${globalFinalTimeInSeconds + SILENT_OUTRO_SECONDS}s`;
  const cutoffTime = `${globalFinalTimeInSeconds + SILENT_OUTRO_SECONDS - 0.01}s`;
  fs.mkdirSync('output', { recursive: true });
  for (let wi = 0; wi < pendingWrites.length; wi++) {
    const { composition, outputFilename } = pendingWrites[wi];
    // Force-kill soundfont release tails so FluidSynth stops at end_track
    let cutoff = '';
    for (let ch = 0; ch < 16; ch++) {
      cutoff += `1,${cutoffTime},control_c,${ch},120,0\n`;  // all sound off
      cutoff += `1,${cutoffTime},control_c,${ch},123,0\n`;  // all notes off
      cutoff += `1,${cutoffTime},control_c,${ch},121,0\n`;  // reset all controllers
    }
    fs.writeFileSync(outputFilename, composition + cutoff + `1,${endTrackTime},end_track`);
    console.log(`Wrote file: ${outputFilename}`);
  }
};
