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
  - `structure/` holds mutable trust/entropy state; treat it as the only write surface for per-beat adaptation in this subtree
  - `emission/` is the SOLE legitimate path to append to any cross-layer buffer — no inline pushes anywhere else
-->
