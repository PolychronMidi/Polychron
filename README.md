Polychron aims to:

- Develop a system that allows for any musical meter (time signature) in MIDI composition, maintaining compatibility with standard MIDI playback systems
- Provide a flexible framework for creating and manipulating complex metrical structures, offering unrestricted polyphony and note granularity, without compromising timing accuracy.

Current implementation is a relatively simple (although impossible for any human to play) demo of (weighted)random meters, scales, and chords at random divisions. Tuning to 432 hz with [binaural beat](https://search.brave.com/search?q=how+does+binaural+beats+work&source=web&conversation=80d48ba0c8ba0614ef212e&summary=1) effects in the alpha range (8-12hz) have been added (must use headphones for binaural effect). Some settings can be customized in `sheet.js`, with plans to move more settings from `polychron.js` to `sheet.js`. Timing markers for each unit can be found in the "marker_t" entries of the CSV file.

Polychron is a MIDI composition system that breaks free from traditional MIDI limitations, particularly in the realm of time signatures (A.K.A. meters). The core innovation of Polychron lies in its ability to work with any musical meter through a process called "meter spoofing."

Because MIDI has been around since the 80's, one artifact is that it only allows standard meters like 4/4. (Some less common meters are allowed, but only if their denominator is a power of 2, like 2, 4, 8, 16, etc.)

Using the `midiCompatibleMeter` function allows for playing any meter (yes, even 420/69) within the constraints of MIDI. Here's how it works:

If the denominator is a power of 2 (MIDI compatible meter), it returns the original meter with no changes.
For denominators that aren't MIDI compatible, it calculates the nearest power of 2.
It then determines a tempo factor to compensate for the measure duration difference between the actual meter and the spoofed MIDI compatible meter.

This approach allows Polychron to represent and work with any meter while maintaining compatibility with standard MIDI playback systems. The result is a composition system that can explore previously inaccessible rhythmic territories within the MIDI framework.

Uses [tonal](https://github.com/tonaljs/tonal) and my own custom fork of [py_midicsv](https://github.com/timwedde/py_midicsv), called [CSV Maestro](https://github.com/i1li/csv_maestro). We create our MIDI data in CSV format first for a nice human-readable version, which allows easier auditing and more direct data control.

To install tonal and create the CSV file, run the following (requires Node.js installed):
```js
npm i tonal
node polychron.js
```

To create the MIDI file from the CSV, run the following (requires Python installed):
```python
py c2m.py
```

You'll need a MIDI player with a soundfont installed to play MIDI files. Standard midi players will likely have playback issues due to data overload, the following have been tested to work:

https://soundfont-midi-player.en.softonic.com/download

https://github.com/jingkaimori/midieditor

You can convert MIDI files to MP3, WAV, or FLAC with:

https://coolsoft.altervista.org/virtualmidisynth

[LibreOffice](https://libreoffice.org/) is a good program for CSV files.

Here's a list of [music related repos](https://github.com/stars/i1li/lists/music) I've saved for inspiration.
