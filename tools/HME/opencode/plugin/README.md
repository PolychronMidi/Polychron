# plugin/

OpenCode CLI plugin entrypoints that relay host lifecycle events into the HME hook kernel.

`hme_hooks.mjs` default-exports the plugin factory, which registers OpenCode plugin hooks:

- `tool.execute.before` -> `PreToolUse`
- `tool.execute.after` -> `PostToolUse`
- `permission.ask` -> `PermissionRequest`
- `event` -> best-effort session lifecycle relay for session start/compact events

The plugin is registered from `~/.config/opencode/opencode.jsonc`. Restart the
OpenCode CLI session after plugin/config edits. Desktop OpenCode is not part of
this supported path.
