#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 c2m.py

SF="$HOME/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2"
INTERP="scripts/fluidsynth-init.txt"

fluidsynth -ni -f "$INTERP" -T wav -O s16 -F output/output1.wav \
  -r 22050 \
  -o synth.sample-rate=22050 \
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
  -o audio.period-size=1024 -o audio.periods=4 \
  -o audio.sample-format=s16 \
  "$SF" output/output1.mid

fluidsynth -ni -f "$INTERP" -T wav -O s16 -F output/output2.wav \
  -r 22050 \
  -o synth.sample-rate=22050 \
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
  -o audio.period-size=1024 -o audio.periods=4 \
  -o audio.sample-format=s16 \
  "$SF" output/output2.mid

ffmpeg -i output/output1.wav -i output/output2.wav \
  -filter_complex amix=inputs=2:duration=longest:dropout_transition=0 \
  -c:a pcm_f32le output/combined.wav -y
