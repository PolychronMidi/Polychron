# opencode/

OpenCode host adapter, plugin bridge, and HME-owned OpenAI-compatible ingress glue.

The supported integration target is the OpenCode CLI (`opencode-ai`). OpenCode
loads the HME bridge through the global CLI config at
`~/.config/opencode/opencode.jsonc`:

```json
"plugin": [
  "file:///home/jah/Polychron/tools/HME/opencode/plugin/hme_hooks.mjs"
]
```

OpenCode reads plugin configuration at startup. Restart the CLI session after
changing the plugin file or config.

The packaged OpenCode desktop app is intentionally out of scope for this bridge.
It has separate process/config behavior and should not be used as evidence for
CLI plugin health.
