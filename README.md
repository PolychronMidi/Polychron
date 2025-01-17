Polychron aims to:

- Develop a system that allows for any musical meter (time signature) in MIDI composition, while still maintaining compatibility with standard MIDI playback systems
- Provide a flexible framework for creating and manipulating complex metrical structures, offering unrestricted polyphony and note granularity, without compromising timing accuracy.

Current implementation is a [~~relatively simple~~](#players) (although impossible for any human to play) demo of (weighted) random, scales, chords, & modes played at random rhythms, divisions & meters. Tuning to 432 hz with [binaural beat](https://search.brave.com/search?q=how+does+binaural+beats+work&source=web&conversation=80d48ba0c8ba0614ef212e&summary=1) effects in the alpha range (8-12hz) have been added, plus random left / right balance variation (must use headphones for binaural effect).

The `Composer` classes and `csvMaestro` main logic is in `polychron.js`. Some settings can be customized in `sheet.js`. To keep the main file a reasonable length, support functions and initialization variables are in `stage.js` & `backstage.js`, roughly in order of decreasing specificity. Timing log markers for each unit can be found in the "marker_t" entries of the CSV file. Log level can be changed in `sheet.js` under LOG, from the default 'measure' value to 'all', 'none', or comma-separated unit names. (If you play the MIDI file with [Soundfont MIDI Player](#players), you can view unit log markers in realtime by clicking the button on the left for 'MIDI text'.)

Polychron is a MIDI composition system that breaks free from traditional MIDI limitations, particularly in the realm of time signatures (A.K.A. meters). The core innovation of Polychron lies in its ability to work with any musical meter through a process called "meter spoofing."

Because MIDI has been around since the 80's, one artifact is that it only allows standard meters like 4/4. (Some less common meters are allowed, but only if their denominator is a power of 2, like 2, 4, 8, 16, etc.)

Using the `midiSync` function allows for playing any meter (yes, even 420/69) within the constraints of MIDI. Here's how it works:

If the denominator is a power of 2 (MIDI compatible meter), it returns the original meter with no changes.
For denominators that aren't MIDI compatible, it calculates the nearest power of 2.
It then determines an adjustment factor, used to sync measure (bar) durations of actual played meters and spoofed MIDI compatible meters.

This approach allows Polychron to represent and work with any meter while maintaining compatibility with standard MIDI playback systems. The result is a composition system that can explore previously inaccessible rhythmic territories within the MIDI framework.

Uses [tonal](https://github.com/tonaljs/tonal) and my own custom fork of [py_midicsv](https://github.com/timwedde/py_midicsv), called [CSV Maestro](https://github.com/i1li/csv_maestro). We create our MIDI data in CSV (spreadsheet) format first for a nice human-readable version, which allows easier auditing and more direct data control.

To install tonal and create the CSV file, run the following (requires Node.js installed):
```js
npm i tonal
node polychron.js
```

To create the MIDI file from the CSV, run the following (requires Python installed):
```python
py c2m.py
```
<span id="players">
You'll need a MIDI player with a soundfont installed to play MIDI files. Standard midi players will likely have playback issues due to data overload, the following have been tested to work:

[Soundfont MIDI Player](https://soundfont-midi-player.en.softonic.com)

[MIDI Editor](https://github.com/jingkaimori/midieditor)

Note that accurate MIDI playback may not be possible on some devices due to extreme data density. In this case you can just render the MIDI file as typical audio formats like MP3. 

You can convert MIDI files to MP3, WAV, or FLAC with:

[Virtual MIDI Synth](https://coolsoft.altervista.org/virtualmidisynth)

</span><br>
[LibreOffice](https://libreoffice.org/) is a good program for CSV files.

Here's a list of [music related repos](https://github.com/stars/i1li/lists/music) I've saved for inspiration.
