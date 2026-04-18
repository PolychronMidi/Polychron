# conductor/signal/foundations

Signal infrastructure — normalization, coherence monitoring, signal reading, telemetry, profile adaptation, health analysis, and phase-space math. This dir is the plumbing layer that all higher signal modules depend on.

`signalReader` is the **only permitted path** for reading conductor signals from cross-layer and composers. Never call `conductorIntelligence.getSignalSnapshot()` directly — `signalReader` applies normalization and coherence correction that the raw snapshot bypasses.

`coherenceMonitor` is a closed-loop controller: it subscribes to `NOTES_EMITTED`, compares actual vs. intended note counts over a 16-beat window, and feeds a correction bias back into the density pipeline. Its bias range [0.60, 1.38] is owned by its own logic — do not patch from callers.

<!-- HME-DIR-INTENT
rules:
  - signalReader is the only permitted path for conductor signal reads — never call conductorIntelligence.getSignalSnapshot() directly
  - coherenceMonitor bias range [0.60, 1.38] is owned by its controller logic — do not patch from callers
-->
