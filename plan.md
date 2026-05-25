❯ how can we universalize through omo further so that we dont even need separate hooks defined in ~/.claude/settings.json and ~/codex/hooks.json , so that
  tools/hme/hooks become the definitive single source of truth?

● Yes. Framing:

  U probably can't make Claude/Codex zero host config, b/c each host still some entrypoint telling it “call HME for hook events.” But u can make
  ~/.claude/settings.json & ~/codex/hooks.json made bootstraps, not sources of truth.

  Target state:

  ▎ tools/HME/hooks/** + HME hook manifest = definitive policy/hook source.
  ▎ Claude/Codex home configs = disposable materialized adapters w/ checksums.

  Arch

  1. Make tools/HME/hooks/manifest.json canonical

  Add one canonical hook registry, either explicit or made from colocated metadata:

  {
    "abi": "hme-opencode-hook/v1",
    "hooks": [
      {
        "id": "pretooluse_bash",
        "phase": "tool.execute.before",
        "script": "tools/HME/hooks/pretooluse/pretooluse_bash.sh",
        "match": { "tool": "Bash" },
        "priority": 100,
        "timeout_ms": 5000,
        "mandatory": true,
        "hosts": ["claude", "codex", "opencode"]
      },
      {
        "id": "stop_chain",
        "phase": "stop.before",
        "script": "tools/HME/hooks/stop.sh",
        "priority": 100,
        "timeout_ms": 30000,
        "mandatory": true,
        "hosts": ["claude", "codex"]
      }
    ]
  }

  Home config gen consumes only this manifest.

  No hand-maintained Claude/Codex hook lists.

  ---
  2. One host shim per host, no policy there

  Home config should call only tiny stable shim:

  node tools/HME/event_kernel/host_hook_entry.js --host claude --event PreToolUse

  Or:

  node tools/HME/event_kernel/host_hook_entry.js --host codex --event pre_tool_use

  Shim does:

  1. Read raw host payload from stdin/env
  2. Translate - hme-opencode-hook/v1
  3. Load tools/HME/hooks/manifest.json
  4. Select matching HME hooks
  5. Run them thru OMO decision resolver
  6. Translate decision back - host output schema

  So ~/.claude/settings.json / ~/codex/hooks.json only define “all events go - HME entrypoint.”

  ---
  3. Materialize home config from HME, atomically

  Add:

  tools/HME/scripts/materialize-host-hooks.js

  Usage:

  node tools/HME/scripts/materialize-host-hooks.js --host claude
  node tools/HME/scripts/materialize-host-hooks.js --host codex
  node tools/HME/scripts/materialize-host-hooks.js --all

  It writes:

  - ~/.claude/settings.json
  - ~/codex/hooks.json

  W/ an HME-owned made block:

  {
    "_hme_generated": {
      "source": "tools/HME/hooks/manifest.json",
      "sha256": "...",
      "generated_at": "...",
      "do_not_edit": true
    }
  }

  Rules:

  - preserve unrelated user settings
  - replace only HME block
  - atomic write via temp file + rename
  - fail if malformed JSON
  - fail if unmanaged HME hook entries exist outside made block

  This makes home configs build artifacts.

  ---
  4. Add drift verifier

  Add verifier:

  tools/HME/scripts/verify-host-hook-materialization.js

  Checks:

  - manifest hash matches made block
  - Claude/Codex made hook blocks exist
  - cmds point - tools/HME/event_kernel/host_hook_entry.js
  - no retired direct hook paths remain
  - no host-local policy fragments exist
  - made files r reproducible byte-for-byte, except timestamp if excluded from checksum

  Hook 2:

  - SessionStart
  - precommit
  - npm run test:hme
  - HCI verifier

  If drift detected:

  FAIL: ~/.claude/settings.json HME hook block stale.
  Run: node tools/HME/scripts/materialize-host-hooks.js --host claude

  Optionally auto-repair if safe.

  ---
  5. Use OMO phases real routing layer

  Map all host events - universal ABI:

  ┌─────────────────────┬─────────────────────────────────────────┐
  │     Host event      │                OMO phase                │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Claude PreToolUse   │ tool.execute.before                     │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Claude PostToolUse  │ tool.execute.after                      │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Claude Stop         │ stop.before                             │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Claude SessionStart │ session.start                           │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Claude PreCompact   │ session.compact.before or HME extension │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Codex tool call     │ tool.execute.before                     │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Codex response text │ stream.text_block                       │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ Codex lifecycle     │ session.*                               │
  ├─────────────────────┼─────────────────────────────────────────┤
  │ OpenCode hook       │ already near-native                     │
  └─────────────────────┴─────────────────────────────────────────┘

  All actual hook selection:

  selectHooks(manifest, universalEvent)

  Not:

  if host === "claude" ...

  Host-specific behavior stays only n adapters/translators.

  ---
  6. Collapse cur hook definitions 2 HME metadata, shell scripts exist under tools/HME/hooksAdd metadata near them:

  tools/HME/hooks/pretooluse/pretooluse_bash.sh
  tools/HME/hooks/pretooluse/pretooluse_bash.meta.json

  Ex:

  {
    "id": "pretooluse_bash",
    "phase": "tool.execute.before",
    "match": { "tool": "Bash" },
    "priority": 100,
    "mandatory": true,
    "timeout_ms": 5000,
    "decision_kinds": ["allow", "deny", "modify"],
    "hosts": ["claude", "codex", "opencode"]
  }

  Build manifest.json from metadata, or treat metadata source directly.

  This avoids one giant registry drifting from script reality.

  ---
  7. Enforce no manual hook config

  Add tests/verifiers grep home materialized files & repo templates:

  Disallow:

  - direct tools/HME/hooks/pretooluse/*.sh paths n ~/.claude/settings.json
  - direct hook script paths n ~/codex/hooks.json
  - host-specific hook cmds not routed thru host_hook_entry.js
  - duplicated hook logic n Claude/Codex config templates

  Allow only:

  tools/HME/event_kernel/host_hook_entry.js

  Or stable wrapper:

  tools/HME/bin/hme-hook

  ---
  Minimal made Claude shape

  Made Claude settings block should look like:

  {
    "hooks": {
      "PreToolUse": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host claude --event PreToolUse"
            }
          ]
        }
      ],
      "PostToolUse": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host claude --event PostToolUse"
            }
          ]
        }
      ],
      "Stop": [
        {
          "matcher": "*",
          "hooks": [
            {
              "type": "command",
              "command": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host claude --event Stop"
            }
          ]
        }
      ]
    }
  }

  Notice: no policy names, no hook script paths, no branching.

  ---
  Minimal made Codex shape

  Same idea:

  {
    "hooks": {
      "tool_call": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host codex --event tool_call",
      "message": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host codex --event message",
      "session": "node $PROJECT_ROOT/tools/HME/event_kernel/host_hook_entry.js --host codex --event session"
    }
  }

  Exact schema depends on Codex hook format, but made cmd remains one HME entrypoint.

  ---
  Migration plan

  1. Add canonical hook manifest / metadata.
  2. Make host_hook_entry.js consume manifest & OMO ABI.
  3. Make Claude settings from manifest.
  4. Make Codex hooks from manifest.
  5. Add drift verifier.
  6. Replace direct home hook cmds w/ made HME entrypoint only.
  7. Add precommit/sessionstart repair or hard-fail.
  8. Delete/retire old manual config templates.
  9. Add tests proving:
  - every manifest hook maps - at least one OMO phase
  - every host made config deterministic
  - no direct hook script paths leak 2 home configs
  - unsupported host phases fail closed
  - mandatory HME denials still outrank plugin allows
