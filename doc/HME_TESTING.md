# HME Testing & Chaos Battery

> Smoke-test and chaos-injection detail. Linked from [HME.md](HME.md).

## Testing & Chaos

HME ships three smoke-test scripts and a chaos-injection battery. Run any directly -- they're self-contained bash scripts that boot the components they need and tear down on exit.

| Script | What it asserts |
| --- | --- |
| `scripts/test/smoke-test-i-wrappers.sh` | Every `i/*` shell wrapper resolves + returns a non-error response |
| `scripts/test/smoke-test-indexing-mode.sh` | Full `/indexing-mode` cycle: daemon+worker reachable -> coder suspended -> embedders reloaded -> index runs -> coder respawns healthy -> selftest still READY |
| `scripts/test/test-lifecycle-writers.py` | Unit test for `server/lifecycle_writers.py` -- 7 assertions covering registry load, accept/reject/unknown-domain, override rejection, idempotency |

Chaos injectors live in `scripts/chaos/`:

| Script | What it injects / asserts |
| --- | --- |
| `inject-silent-thread-crash.sh` | Appends a fake `Exception in thread` line to the daemon log; asserts the `daemon thread hygiene` selftest probe flips FAIL |
| `inject-duplicate-llama-server.sh` | Spawns a decoy process matching the llama-server pgrep pattern; asserts the `llama-server count` probe catches the count exceeding topology |
| `run-all.sh` | Runs every injector as a battery; any injector whose probe doesn't catch it is a dead probe |

Run after any selftest-probe change: `bash scripts/chaos/run-all.sh`. A probe that can't detect the fault it was written to catch is worse than no probe -- it produces false confidence.

