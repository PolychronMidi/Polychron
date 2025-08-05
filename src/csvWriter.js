// CSV Writer - CLEAN SIMPLE VERSION
export class CSVWriter {
  constructor(config = {}) {
    this.config = {
      filename: 'output.csv',
      ppq: 30000,
      bpm: 72,
      ...config
    };
    
    this.csvLines = [];
    this.trackLength = 0;
    
    // Basic header
    this.csvLines.push(`0, 0, Header, 2, ${this.config.ppq}`);
    this.csvLines.push(`1, 0, Start_track`);
    
    // Initial tempo/meter
    const initialTempo = Math.round(60000000 / this.config.bpm);
    this.csvLines.push(`1, 0, Tempo, ${initialTempo}`);
    this.csvLines.push(`1, 0, Time_signature, 4, 2, 24, 8`);
  }

  addTempo(tick, bpm) {
    const microseconds = Math.round(60000000 / bpm);
    this.csvLines.push(`1, ${Math.round(tick)}, Tempo, ${microseconds}`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addTimeSignature(tick, num, den) {
    const midiDen = Math.round(Math.log2(den));
    this.csvLines.push(`1, ${Math.round(tick)}, Time_signature, ${num}, ${midiDen}, 24, 8`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addMarker(tick, text) {
    this.csvLines.push(`1, ${Math.round(tick)}, Marker_t, "${text}"`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addNoteOn(tick, channel, note, velocity) {
    if (isNaN(tick) || isNaN(channel) || isNaN(note) || isNaN(velocity)) return;
    tick = Math.max(0, Math.round(tick));
    channel = Math.max(0, Math.min(15, Math.round(channel)));
    note = Math.max(0, Math.min(127, Math.round(note)));
    velocity = Math.max(1, Math.min(127, Math.round(velocity)));
    this.csvLines.push(`1, ${tick}, Note_on_c, ${channel}, ${note}, ${velocity}`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addNoteOff(tick, channel, note) {
    if (isNaN(tick) || isNaN(channel) || isNaN(note)) return;
    tick = Math.max(0, Math.round(tick));
    channel = Math.max(0, Math.min(15, Math.round(channel)));
    note = Math.max(0, Math.min(127, Math.round(note)));
    this.csvLines.push(`1, ${tick}, Note_off_c, ${channel}, ${note}, 0`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addControlChange(tick, channel, controller, value) {
    if (isNaN(tick) || isNaN(channel) || isNaN(controller) || isNaN(value)) return;
    tick = Math.max(0, Math.round(tick));
    channel = Math.max(0, Math.min(15, Math.round(channel)));
    controller = Math.max(0, Math.min(127, Math.round(controller)));
    value = Math.max(0, Math.min(127, Math.round(value)));
    this.csvLines.push(`1, ${tick}, Control_c, ${channel}, ${controller}, ${value}`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addProgramChange(tick, channel, program) {
    if (isNaN(tick) || isNaN(channel) || isNaN(program)) return;
    tick = Math.max(0, Math.round(tick));
    channel = Math.max(0, Math.min(15, Math.round(channel)));
    program = Math.max(0, Math.min(127, Math.round(program)));
    this.csvLines.push(`1, ${tick}, Program_c, ${channel}, ${program}`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addPitchBend(tick, channel, value) {
    if (isNaN(tick) || isNaN(channel) || isNaN(value)) return;
    tick = Math.max(0, Math.round(tick));
    channel = Math.max(0, Math.min(15, Math.round(channel)));
    value = Math.max(0, Math.min(16383, Math.round(value)));
    this.csvLines.push(`1, ${tick}, Pitch_bend_c, ${channel}, ${value}`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  addText(tick, text) {
    if (isNaN(tick) || !text) return;
    tick = Math.max(0, Math.round(tick));
    this.csvLines.push(`1, ${tick}, Text_t, "${text}"`);
    if (tick > this.trackLength) this.trackLength = tick;
  }

  grandFinale(state) {
    const finalTick = this.trackLength + 1000;
    for (let channel = 0; channel < 16; channel++) {
      this.addControlChange(finalTick, channel, 123, 0);
      this.addControlChange(finalTick, channel, 121, 0);
    }
    const endTick = this.trackLength + 2000;
    this.csvLines.push(`1, ${endTick}, End_track`);
    this.csvLines.push(`0, 0, End_of_file`);
  }

  export() {
    const csv = this.csvLines.join('\n');
    const durationSeconds = this.trackLength / (this.config.ppq * this.config.bpm / 60);
    const minutes = Math.floor(durationSeconds / 60);
    const seconds = (durationSeconds % 60).toFixed(4);
    const durationString = `${minutes}:${seconds.padStart(7, '0')}`;

    if (typeof require !== 'undefined') {
      const fs = require('fs');
      fs.writeFileSync(this.config.filename, csv);
    }

    return {
      content: csv,
      duration: durationString,
      filename: this.config.filename
    };
  }
}