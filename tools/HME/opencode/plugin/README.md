# plugin/

OpenCode plugin entrypoints that relay host lifecycle events into the HME hook kernel.

`hme_hooks.mjs` exports `HmeHooks(ctx)`, which registers OpenCode plugin hooks:

- `tool.execute.before` -> `PreToolUse`
- `tool.execute.after` -> `PostToolUse`
- `permission.ask` -> `PermissionRequest`
- `session.created` -> `SessionStart`
- `session.compacted` -> `PostCompact`

The plugin is registered from `~/.config/opencode/opencode.jsonc`. OpenCode must
be restarted after plugin/config edits.
