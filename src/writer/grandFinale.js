// grandFinale.js - Finalize and write out all layer buffers to CSV files

const V = validator.create('grandFinale');

grandFinale = () => {
  if (!LM.layers) throw new Error('grandFinale: LM.layers must be a defined object');
  V.assertObject(LM.layers, 'LM.layers');
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
  // Flag for per-layer checks via a local variable in closure
  layerData.forEach(({ name, buffer }) => {
    // Set naked global buffer `c` to this layer's buffer
    c = buffer;

    // Finalize buffer
    if (!Array.isArray(buffer)) {
      try {
        V.assertObject(buffer, 'buffer');
        V.assertArray(buffer.rows, 'buffer.rows');
      } catch {
        throw new Error(`grandFinale: layer "${name}" buffer must be an array or object with rows array`);
      }
      buffer = buffer.rows;
    }
    buffer = buffer.filter(i => i !== null)
      .map(i => {
        if (!i) throw new Error(`grandFinale: layer "${name}" contains non-object event entry`);
        V.assertObject(i, 'i');
        const rawTick = i.tick;
        let tickNum = 0;
        if (typeof rawTick === 'string' && rawTick.indexOf('|') !== -1) {
          tickNum = Number(String(rawTick).split('|')[0]);
        } else if (Number.isFinite(rawTick)) {
          tickNum = Number(rawTick);
        } else if (typeof rawTick === 'string') {
          tickNum = Number(rawTick);
        }
        V.requireFinite(tickNum, 'tickNum');
        let tickVal = tickNum;
        if (tickVal < 0) {
          throw new Error(`grandFinale: event tick must be >= 0, received ${tickVal}`);
        }
        tickVal = m.round(tickVal);
        return { ...i, tick: tickVal, grandFinaleTickSortKey: tickVal, grandFinaleTickRaw: rawTick };
      })
      .sort((a, b) => {
        try {
          V.requireFinite(a.grandFinaleTickSortKey, 'a.grandFinaleTickSortKey');
          V.requireFinite(b.grandFinaleTickSortKey, 'b.grandFinaleTickSortKey');
        } catch {
          throw new Error('grandFinale: sort keys must be finite numbers');
        }
        return a.grandFinaleTickSortKey - b.grandFinaleTickSortKey;
      });

    // Generate CSV
    let composition = `0,0,header,1,1,${PPQ}\n1,0,start_track\n`;
    let finalTick = -Infinity;

    buffer.forEach(_ => {
      if (!isNaN(_.tick)) {
        const type = _.type === 'on' ? 'note_on_c' : (_.type ? _.type : 'note_off_c');
        const tickNum = _.tick;
        V.requireFinite(tickNum, 'tickNum');
        const tickInt = m.round(Number(tickNum));

        // Event with undefined pitch is a serious bug in note generation
        if (Array.isArray(_.vals)) {
          // For note_on_c/note_off_c, pitch is at index 1
          if ((type === 'note_on_c' || type === 'note_off_c') && (_.vals[1] === undefined || _.vals[1] === null)) {
            throw new Error(`${type} event has undefined pitch at tick ${tickInt}: event=${JSON.stringify(_)}; vals=${JSON.stringify(_.vals)}`);
          }
        } else {
          throw new Error(`${type} event has invalid vals format at tick ${tickInt}: event=${JSON.stringify(_)}`);
        }

        if (type === 'note_on_c' || type === 'note_off_c') {
          const ch = Number(_.vals[0]);
          const pitch = Number(_.vals[1]);
          V.requireFinite(ch, 'ch');
          if (ch < 0 || ch > 15) {
            throw new Error(`${type} event has invalid channel ${_.vals[0]} at tick ${tickInt}: event=${JSON.stringify(_)}`);
          }
          V.requireFinite(pitch, 'pitch');
          if (pitch < 0 || pitch > MIDI_MAX_VALUE) {
            throw new Error(`${type} event has invalid pitch ${_.vals[1]} at tick ${tickInt}: event=${JSON.stringify(_)}`);
          }
          _.vals[0] = m.round(ch);
          _.vals[1] = m.round(pitch);
        }

        // Validate velocity for Note_on events (rounded, strict MIDI range)
        if (type === 'note_on_c' && Array.isArray(_.vals) && _.vals.length >= 3) {
          const vel = Number(_.vals[2]);
          V.requireFinite(vel, 'vel');
          if (vel < 0 || vel > MIDI_MAX_VALUE) {
            throw new Error(`note_on_c event has invalid velocity ${_.vals[2]} at tick ${tickInt}: event=${JSON.stringify(_)}`);
          }
          _.vals[2] = m.round(vel);
        }

        composition += `1,${tickInt},${type},${_.vals.join(',')}\n`;
        finalTick = m.max(finalTick, tickNum, tickInt);
      }
    });

    V.requireFinite(finalTick, 'finalTick');
    if (finalTick < 0) {
      throw new Error(`grandFinale: layer "${name}" produced no valid events (finalTick=${finalTick})`);
    }
    composition += `1,${finalTick},end_track`;
    const outputFilename = name === 'L1' ? 'output/output1.csv' : name === 'L2' ? 'output/output2.csv' : `output/output${name.charAt(0).toUpperCase() + name.slice(1)}.csv`;
    fs.mkdirSync('output', { recursive: true });
    fs.writeFileSync(outputFilename, composition);
    console.log(`Wrote file: ${outputFilename}`);

  });
};
