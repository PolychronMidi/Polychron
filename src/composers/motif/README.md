# composers/motif

Motif tracking, development, and hierarchical planning from measure down to subsubdiv. `motifManager.planMeasure(layer, composer)` is the entry point for measure-level hierarchy; it must be called once per measure from `setUnitTiming('measure')`, not from beat handlers.

## Drum texture coupling

`planMeasure` reads drum burst/flurry metrics and clamps motif density and interval-density through `conductorConfig.getMotifTextureClampParams()`. **Never read drum texture metrics directly** from a motif module — all texture coupling flows through that accessor so the coupling surface stays declared and auditable.

## Hierarchy contract

Motif content at every sub-level (beat, div, subdiv, subsubdiv) must derive from the measure-level plan. Side-stepping `planMeasure` and generating beat motifs from scratch produces incoherent content that ignores the macro arc. `motifManagerResetChildVM()` invalidates the child VoiceManager — call it whenever the measure plan changes, not on every beat.

<!-- HME-DIR-INTENT
rules:
  - planMeasure() is called once per measure from setUnitTiming('measure') only — never from beat or sub-beat handlers
  - Drum texture coupling flows through conductorConfig.getMotifTextureClampParams(); never read drum metrics directly from motif modules
  - All sub-level motif content must derive from the measure plan — skip planMeasure and the macro arc is silently ignored
-->
