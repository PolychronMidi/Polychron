Bridge between HME and oh-my-openagent/OpenCode-compatible hook surfaces.

The bridge owns `hme-opencode-hook/v1` as HME's universal hook ABI:

- OpenCode-compatible core phases: `chat.params`, `permission.ask`, `tool.execute.before`, `tool.execute.after`.
- HME extension phases: `stop.before`, `stream.text_block`.
- Validators live in `universal_event.js`, `universal_decision.js`, and `contract_validator.js`.

See `doc/hme-opencode-universal-hook-abi.md` for the migration contract.

Live OpenCode routing is wired in shadow mode through `shadow_runtime.js` and
`event_kernel/dispatcher.js`. Enable it with:

- `HME_OMO_ENABLED=1`
- `HME_OMO_MODE=shadow`
- `HME_OMO_SOURCE=path` and `HME_OMO_PATH=tools/oh-my-openagent`, or `HME_OMO_SOURCE=package` with `HME_OMO_PACKAGE=oh-my-openagent`
- optional `HME_OMO_REQUIRED_VERSION`
- optional `HME_OMO_TIMEOUT_MS`

Shadow observations are fail-open. Missing OMO builds, load failures, invalid
events, plugin errors, and timeouts are emitted as `omo_shadow_observed`
telemetry and never change HME/OpenCode hook decisions.
