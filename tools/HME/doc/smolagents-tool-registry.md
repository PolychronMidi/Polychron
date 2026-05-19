# smolagents HME tool registry

HME's canonical custom tools now live as smolagents `Tool` subclasses.

The agent-facing names intentionally stay bare/native-looking:

```text
Agent
Bash
Edit
Read
WebFetch
WebSearch
Write
```

Do not prefix these names with `hme_`. The proxy, graph, and model schemas should preserve the same names so tools are indistinguishable from native tools from the agent perspective.

## Source of truth

```text
tools/HME/hme_tools/base.py
tools/HME/hme_tools/tools.py
```

`HMETool` subclasses `smolagents.Tool` and adds HME metadata:

- `side_effect`
- `approval`
- `idempotent`
- `max_output_bytes`
- `aliases`
- `visibility`
- `policy`

The smolagents fields remain the canonical model-facing contract:

- `name`
- `description`
- `inputs`
- `output_type`
- `output_schema`
- `forward()`

## Export surfaces

Use:

```bash
python3 tools/HME/hme_tools/export.py --kind codex
python3 tools/HME/hme_tools/export.py --kind hme
```

`codex`/`openai`/`claude` exports model tool schemas with bare names.

`hme` exports the same schemas plus HME policy metadata.

The Node proxy consumes these through:

```text
tools/HME/proxy/hme_tool_registry.js
tools/HME/proxy/codex_uniform_tools.js
```

## Execution

Use:

```bash
python3 tools/HME/hme_tools/run_tool.py Bash --json <<< '{"command":"printf ok"}'
```

`run_tool.py` executes by bare tool name. Existing JS structured tool behavior remains the execution backend for Read/Edit/Write/WebFetch/Agent while the canonical declaration moves to smolagents.

## Test contract

```bash
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
```

The tests assert:

- exact bare tool names
- no `hme_` prefixes
- exported schemas are function/object schemas
- HME policy metadata is separate from model schema
- bare-name tool execution works
