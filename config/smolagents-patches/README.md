# smolagents Local Patches

`tools/smolagents/` is an ignored vendored checkout. Keep local customizations here as tracked patch files instead of tracking the vendored source tree.

## Patches

- `001-local-adjustments.patch` preserves the current local source deltas found before refreshing from upstream `huggingface/smolagents` `main`.

## Apply

From the repository root:

```sh
git -C tools/smolagents apply ../../config/smolagents-patches/001-local-adjustments.patch
```

The current vendored smolagents checkout is refreshed from upstream `huggingface/smolagents` `main`; generated `src/smolagents.egg-info/` files are intentionally not captured.
