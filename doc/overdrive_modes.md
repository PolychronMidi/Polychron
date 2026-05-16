# Overdrive Modes

Canonical `OVERDRIVE_MODE` semantics:

- `0` or unset: cascade-only/off.
- `1`: active team-role registry routing through `config/models.json`; interactive Claude and Codex proxy traffic use OmniRoute for provider translation and request visibility.
- `2`..`6`: retired; intentionally fall through to cascade/no-op.

Mode `1` uses native team routing and OmniRoute. Keep `OVERDRIVE_VIA_SUBAGENT=0` unless debugging the old direct-Anthropic sentinel bridge.
