# HME canonical tool registry

`tools/HME/hme_tools` is the single source of truth for HME's native-looking tool surface.

## Contract

- Tool names stay bare and model-facing: `Agent`, `Bash`, `Edit`, `Read`, `WebFetch`, `WebSearch`, `Write`.
- `HMETool` subclasses define the schema, execution adapter, and HME metadata together.
- The OpenAI/Codex schema exported by `export.py --kind codex` contains only the model-facing function schema.
- The HME schema exported by `export.py --kind hme` adds policy metadata under `hme`; this metadata is not prompt text.
- `run_tool.py <ToolName> --json` is the execution bridge used by Codex passthrough rewriting for non-host-native tools.
- `validate_tool.py <ToolName> --json` is the validation/approval metadata surface for hook/proxy policy checks.

## Metadata fields

`hme` metadata currently includes:

- `side_effect`: read/write/shell/network/agent classification.
- `approval`: `never`, `destructive`, or `always`.
- `idempotent`: whether repeated execution is expected to be safe.
- `input_aliases`: accepted compatibility aliases, e.g. `file -> file_path`, `cmd -> command`.
- `passthrough_target`: Codex host tool target such as `exec_command` or `web_search`.
- `bridge_action`: legacy structured-tool action name retained for compatibility and display normalization.
- `host_native`: true when execution belongs to the host rather than `run_tool.py`.
- `visibility`: compact progress/result labels.
- `policy`: machine-readable policy details such as Bash destructive-command patterns.

## Codex bridge policy

New native-tool rewriting uses:

```bash
python3 tools/HME/hme_tools/run_tool.py Read --json <<'HME_CODEX_JSON'
{"file_path":"README.md","limit":5}
HME_CODEX_JSON
```

`tools/HME/scripts/codex_structured_tool.js` remains supported for old transcripts and display normalization. Do not add new Codex native-tool rewrites to that legacy bridge unless maintaining backward compatibility.

## Schema drift

`tools/HME/tests/fixtures/hme-tools-codex.snapshot.json` is the checked Codex schema snapshot. If a deliberate tool-schema change lands, regenerate it with:

```bash
python3 tools/HME/hme_tools/export.py --kind codex --output tools/HME/tests/fixtures/hme-tools-codex.snapshot.json
mkdir -p tmp
python3 -m json.tool tools/HME/tests/fixtures/hme-tools-codex.snapshot.json > tmp/hme-tools-codex.pretty
mv tmp/hme-tools-codex.pretty tools/HME/tests/fixtures/hme-tools-codex.snapshot.json
```

Then run:

```bash
node --test tools/HME/tests/specs/smolagents_tool_registry.test.js
```
