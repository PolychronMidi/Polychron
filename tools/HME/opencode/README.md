# opencode/

OpenCode host adapter, plugin bridge, and HME-owned OpenAI-compatible ingress glue.

OpenCode loads the HME bridge through the global config at
`~/.config/opencode/opencode.jsonc`:

```json
"plugin": [
  "file:///home/jah/Polychron/tools/HME/opencode/plugin/hme_hooks.mjs"
]
```

OpenCode reads plugin configuration at startup. Restart OpenCode after changing
the plugin file or config.
