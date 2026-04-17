# crossLayer

Consumer of conductor signals, producer of per-beat emission decisions. Signal processing, trust ecology, structural coupling, and per-note emission gating live here. Subordinate to `conductor` — reads its signals, cannot write them.

The write-firewall to conductor is strict and enforced by lint (`local/no-direct-crosslayer-write-from-conductor` and its inverse) and by the 9 declared firewall ports in `metrics/feedback_graph.json`. Any new cross-boundary data flow must declare a port.

## Structure

- `structure/` — trust ecology, entropy metrics, adaptive score caching; most mutable state lives here
- `signal/` — L0 channel plumbing + `signalReader` (the ONLY permitted path for reading conductor state)
- `emission/` — `crossLayerEmissionGateway`, sole legitimate entry point for buffer writes
- `heatmap/` — trust-system heatmap generation

See [metrics/feedback_graph.json](../../metrics/feedback_graph.json) for the port topology and [doc/ARCHITECTURE.md](../../doc/ARCHITECTURE.md) for the boundary rationale.

<!-- HME-DIR-INTENT
rules:
  - Cannot write to conductor — only local playProb/stutterProb + explainabilityBus diagnostics are permitted
  - Route all buffer emissions through `crossLayerEmissionGateway.emit(sourceModule, buffer, event)` — never push() directly
  - New feedback loops must register with `feedbackRegistry` and be declared in `metrics/feedback_graph.json`
  - Use `trustSystems.names.*` / `trustSystems.heatMapSystems.*` — never hardcode trust system strings
  - Inter-module communication uses `L0` channels with `L0_CHANNELS.xxx` constants; bare strings are a hard error (local/no-bare-l0-channel)
-->
