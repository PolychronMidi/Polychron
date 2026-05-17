#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."

OUT="${COMPOSITION_OUTPUT_DIR:-src/output}"
mkdir -p "$OUT"
python3 src/scripts/c2m.py

SF="$HOME/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2"
INTERP="src/scripts/fluidsynth-init.txt"

fluidsynth -ni -f "$INTERP" -T wav -O float -F "$OUT/output1.wav" \
  -r 96000 \
  -o synth.sample-rate=96000 \
  -o synth.polyphony=65535 \
  -o synth.cpu-cores=20 \
  -o synth.dynamic-sample-loading=0 \
  -o synth.overflow.age=10000 \
  -o synth.overflow.volume=500 \
  -o synth.overflow.released=-10000 \
  -o synth.overflow.sustained=-10000 \
  -o synth.overflow.important=50000 \
  -o synth.reverb.active=0 \
  -o synth.chorus.active=0 \
  -o audio.period-size=4096 -o audio.periods=16 \
  -o audio.sample-format=float \
  "$SF" "$OUT/output1.mid"

fluidsynth -ni -f "$INTERP" -T wav -O float -F "$OUT/output2.wav" \
  -r 96000 \
  -o synth.sample-rate=96000 \
  -o synth.polyphony=65535 \
  -o synth.cpu-cores=20 \
  -o synth.dynamic-sample-loading=0 \
  -o synth.overflow.age=10000 \
  -o synth.overflow.volume=500 \
  -o synth.overflow.released=-10000 \
  -o synth.overflow.sustained=-10000 \
  -o synth.overflow.important=50000 \
  -o synth.reverb.active=0 \
  -o synth.chorus.active=0 \
  -o audio.period-size=4096 -o audio.periods=16 \
  -o audio.sample-format=float \
  "$SF" "$OUT/output2.mid"

ffmpeg -i "$OUT/output1.wav" -i "$OUT/output2.wav" \
  -filter_complex amix=inputs=2:duration=longest:dropout_transition=0 \
  -c:a pcm_f32le "$OUT/combined.wav" -y
