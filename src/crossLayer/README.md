---
name: crossLayer
rules:
  - Cannot write to conductor — only local playProb/stutterProb + explainabilityBus diagnostics are permitted
  - Route all buffer emissions through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)` — never push() directly
  - New feedback loops must register with `feedbackRegistry` and be declared in `metrics/feedback_graph.json`
  - Use `trustSystems.names.*` / `trustSystems.heatMapSystems.*` — never hardcode trust system strings
  - Inter-module communication uses `L0` channels with `L0_CHANNELS.xxx` constants; bare strings are a hard error (local/no-bare-l0-channel)
info: |
  The cross-layer subsystem — signal processing, trust ecology, structural
  coupling, and per-note emission gating. Subordinate to conductor (reads its
  signals, cannot write them). The firewall is enforced by ESLint rules
  (local/no-direct-crosslayer-write-from-conductor and inverse) and by the
  9 declared firewall ports in metrics/feedback_graph.json — any new
  cross-boundary data flow must declare a port.
children:
  structure/: Trust ecology, entropy metrics, adaptive score caching — where most of the mutable state lives
  signal/: L0 channel plumbing + signalReader (the ONLY permitted path for reading conductor state)
  emission/: crossLayerEmissionGateway — sole legitimate entry point for buffer writes
  heatmap/: Trust-system heatmap generation
---

# crossLayer

Consumer of conductor signals, producer of per-beat emission decisions. The write-firewall to conductor is strict and enforced by lint + runtime checks. Feedback loops must be declared, not implicit.

See `metrics/feedback_graph.json` for the port topology and `doc/ARCHITECTURE.md` for the boundary rationale.
