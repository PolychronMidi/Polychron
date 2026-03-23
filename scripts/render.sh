#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 c2m.py

fluidsynth -ni -T wav -F output/output1.wav \
  -o synth.polyphony=4096 -o audio.period-size=4096 -o audio.periods=16 \
  "$HOME/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2" output/output1.mid

fluidsynth -ni -T wav -F output/output2.wav \
  -o synth.polyphony=4096 -o audio.period-size=4096 -o audio.periods=16 \
  "$HOME/Downloads/SGM-v2.01-NicePianosGuitarsBass-V1.2.sf2" output/output2.mid

ffmpeg -i output/output1.wav -i output/output2.wav \
  -filter_complex amix=inputs=2:duration=longest:dropout_transition=0 \
  output/combined.wav -y
