# TODO

<!-- todo-state:
  max_id: 10145
  updated_ts: 1779905479.1331637
  codex_plan_synced_ts: 1779120063.0248382
  codex_plan_source: ${HOME}/.codex/sessions/2026/05/18/rollout-2026-05-18T10-36-38-019e3bbb-6af6-7362-a61a-e05ecf3770ce.jsonl
  opencode_todo_synced_ts: 1779892413.781
  entries:
    10126:
      source: native
      ts: 1779905414.643
    10127:
      source: native
      ts: 1779905414.643
    10101:
      source: opencode
      ts: 1779507931.47
    10111:
      source: opencode
      ts: 1779815256.226
    10115:
      source: opencode
      ts: 1779839880.82
    10116:
      source: opencode
      ts: 1779859522.856
    10102:
      source: opencode
      ts: 1779507931.47
    10103:
      source: opencode
      ts: 1779507931.47
    10112:
      source: opencode
      ts: 1779815256.226
    10113:
      source: opencode
      ts: 1779815256.226
    10114:
      source: opencode
      ts: 1779815256.226
    10117:
      source: opencode
      ts: 1779859522.856
    10118:
      source: opencode
      ts: 1779859522.856
    10119:
      source: opencode
      ts: 1779859522.856
    9584:
      source: hme_todo
      ts: 1779884154
    9585:
      source: hme_todo
      ts: 1779884154
    9586:
      source: hme_todo
      ts: 1779884154
    9587:
      source: hme_todo
      ts: 1779884253
    9588:
      source: hme_todo
      ts: 1779884253
    10091:
      source: opencode
      ts: 1778632024.989
    10092:
      source: opencode
      ts: 1778632024.989
    10093:
      source: opencode
      ts: 1778632024.989
    10094:
      source: opencode
      ts: 1779166555.249
    10095:
      source: opencode
      ts: 1779166555.249
    10096:
      source: opencode
      ts: 1779166555.249
    10097:
      source: opencode
      ts: 1779507931.47
    10098:
      source: opencode
      ts: 1779507931.47
    10099:
      source: opencode
      ts: 1779507931.47
    10100:
      source: opencode
      ts: 1779507931.47
    10104:
      source: opencode
      ts: 1779551966.636
    10105:
      source: opencode
      ts: 1779551966.636
    10106:
      source: opencode
      ts: 1779551966.636
    10107:
      source: opencode
      ts: 1779814216.029
    10108:
      source: opencode
      ts: 1779814216.029
    10109:
      source: opencode
      ts: 1779814216.029
    10110:
      source: opencode
      ts: 1779814216.029
    10120:
      source: opencode
      ts: 1779887165.794
    10121:
      source: opencode
      ts: 1779888381.57
    10122:
      source: opencode
      ts: 1779888819.018
    10123:
      source: opencode
      ts: 1779892402.506
    10124:
      source: opencode
      ts: 1779892411.678
    10125:
      source: opencode
      ts: 1779892413.781
-->

> Single source of truth. TodoWrite, codex update_plan, lifesaver, and humans all edit this file.

## Now

- [ ] [E3] Fix omniroute 'No credentials for provider: claude' error  #10101
- [ ] [E3] Inspect opencode and oh-my-openagent related files  #10111
- [ ] [E3] Implement general failed-tool retry guard at tool-call layer with tests  #10115
- [ ] [E3] Survey repository structure, commands, and current status without reading secrets  #10116

## Next

- [ ] [E3] Fix SessionStart hook latency (>10s) issue  #10102
- [ ] [E3] Restart hme-proxy to apply all fixes  #10103
- [ ] [E3] Determine integration gaps and required config changes  #10112
- [ ] [E3] Implement minimal integration changes  #10113
- [ ] [E3] Verify configuration and document usage  #10114
- [ ] [E3] Identify highest-impact defects or coherence issues to fix now  #10117
- [ ] [E3] Implement targeted project-wide fixes  #10118
- [ ] [E3] Run relevant verification and report evidence  #10119

## Done

- [x] [E3] strict-mode todo smoke alpha  #9584
- [x] [E3] strict-mode todo smoke beta  #9585
- [x] [E3] strict-mode todo smoke gamma  #9586
- [x] [E3] strict-mode todo smoke delta  #9587
- [x] [E3] strict-mode todo smoke epsilon  #9588
- [x] [E3] Block passthrough/escape-hatch Anthropic fallback when MODE=5  #10091
- [x] [E3] Fix OmniRoute opencode-go credentials (expired key, -go suffix mismatch)  #10092
- [x] [E3] Verify proxy model swap catches all interactive claude-* requests  #10093
- [x] [E3] Create omni_tool_loop.js module: extract tool_use blocks from Anthropic responses, execute via bridge, build follow-up payloads  #10094
- [x] [E3] Integrate tool loop into hme_proxy_anthropic_response.js for OmniRoute swaps  #10095
- [x] [E3] Verify syntax and review final result  #10096
- [x] [E3] Fix circular dependency warnings (verify upstream.js is clean)  #10097
- [x] [E3] Fix middleware.runPipeline undefined error in hme_proxy_claude.js  #10098
- [x] [E3] Fix isTransientStreamTimeout undefined error in upstream_failure.js  #10099
- [x] [E3] Fix NUL byte spam from sparse file race in log redirects  #10100
- [x] [E3] Eliminate barrel file contexts/failure_policy/index.js and fix hme_proxy_core.js imports  #10104
- [x] [E3] Add madge circular dependency check to package.json scripts  #10105
- [x] [E3] Document import-from-source convention  #10106
- [x] [E3] Mark OpenCode integration as CLI-only in HME docs  #10107
- [x] [E3] Verify OpenCode plugin tests still pass  #10108
- [x] [E3] Verify real opencode-ai CLI config loads plugin cleanly  #10109
- [x] [E3] Report exact remaining status and next command  #10110
- [x] [E3] Proxy restart TodoWrite smoke test  #10120
- [x] [E3] Test todo system by creating a todo  #10121
- [x] [E3] Test TODO system by creating an item  #10122
- [x] [E3] Test todo system by creating and completing a todo  #10123
- [x] [E3] Test TODO system by creating a todo and marking it done  #10124
- [x] [E3] Test TODO system by creating a todo  #10125
- [x] [E3] Test todo item one  #10126
- [x] [E3] Test todo item two  #10127

## Later

(empty)
