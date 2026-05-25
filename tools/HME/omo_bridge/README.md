Bridge between HME and oh-my-openagent/OpenCode-compatible hook surfaces.

The bridge owns `hme-opencode-hook/v1` as HME's universal hook ABI:

- OpenCode-compatible core phases: `chat.params`, `permission.ask`, `tool.execute.before`, `tool.execute.after`.
- HME extension phases: `stop.before`, `stream.text_block`.
- Validators live in `universal_event.js`, `universal_decision.js`, and `contract_validator.js`.

See `doc/hme-opencode-universal-hook-abi.md` for the migration contract.
