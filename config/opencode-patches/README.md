# OpenCode Local Patches

`tools/opencode/` is an ignored vendored checkout. Keep local OpenCode customizations here as tracked patch files instead of tracking the vendored source tree.

## Patches

- `001-hme-session-stop-parity.patch` adds an awaited `session.stop` plugin hook to OpenCode's cancel path so HME `Stop` can block interrupt/abort before `SessionRunState.cancel()` runs.

## Apply

From the repository root:

```sh
git -C tools/opencode apply ../../config/opencode-patches/001-hme-session-stop-parity.patch
```

The current vendored OpenCode checkout was refreshed from upstream `anomalyco/opencode` `dev` at `0448a3082132cd05dd91e80ff2a93b465ef4c872` before this patch was refreshed.

After updating `tools/opencode`, reapply the patch and resolve conflicts in the vendored checkout if upstream touched the same OpenCode files.
