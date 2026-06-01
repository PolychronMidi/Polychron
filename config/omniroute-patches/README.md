# OmniRoute Local Integration

`tools/omniroute/` is currently a tracked local npm wrapper, not an ignored full vendored source tree.

## Current State

- `package.json` depends on npm `omniroute` `^3.8.3`.
- `package-lock.json` is maintained with `npm install --package-lock-only --legacy-peer-deps` from `tools/omniroute/`.
- `start.sh` is the HME integration launcher and should be preserved as local integration code.

The upstream full source repository is `diegosouzapw/OmniRoute` `main`, currently observed at `89aa761e667b38e25eb044e69b524e90de99cbe9`. We do not replace `tools/omniroute/` with that full source tree because this directory intentionally wraps the npm package plus HME startup behavior.

Use `tools/update/vendor-update.sh --all` to update the npm dependency/lockfile without replacing the wrapper directory. The updater uses `--legacy-peer-deps` because OmniRoute depends on React 19 through packages that are React 19 compatible, but `@emoji-mart/react@1.1.1` still publishes a stale React 16/17/18 peer range and has no newer release.
