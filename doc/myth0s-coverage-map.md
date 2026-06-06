# myth0s Mesh Coverage Map (Workstream B2)

A reviewed map of the load-bearing surfaces where an agent can mutate state,
consume context, or enforce policy. Each surface has a review status so coverage
is tracked, not ad hoc. The mesh (fork/full-tool, capsule-grounded, sequential)
is pointed at `pending` surfaces under the calibrated claim-audit discipline.

Status: reviewed (mesh round done + grounded fixes applied or clean audit),
pending (not yet reviewed this phase), partial (reviewed in part).

`teams/rounds/select_target.py` reads this file to pick the next pending target.

## Policy-enforcement surfaces (a wrong decision ships or blocks a write/run)
| surface | file | status |
| --- | --- | --- |
| pre-write gate | tools/HME/proxy/pre_write_check.js | reviewed |
| dispatch guard | tools/HME/scripts/team_dispatch_guard.py | reviewed |
| team router | tools/HME/scripts/team_agent_router.py | reviewed |
| tool filter | tools/HME/proxy/middleware/03_filter_tools.js | reviewed |
| stop-chain policy | tools/HME/proxy/stop_chain/index.js | reviewed |
| apply-patch gate | tools/HME/proxy/apply_patch_gate.js | pending |
| bash command policy | tools/HME/proxy/bash_command_policy.js | pending |

## State-mutation surfaces (corrupt/lose durable state)
| surface | file | status |
| --- | --- | --- |
| review harness | teams/rounds/round_measured.sh | reviewed |
| state registry | tools/HME/proxy/state_registry.js | reviewed |
| session-state lifecycle | tools/HME/proxy/session_state.js | pending |
| todo engine store | tools/HME/todo_engine/store.py | pending |

## Context-consumption surfaces (stale/incoherent context burn)
| surface | file | status |
| --- | --- | --- |
| peer comms | tools/HME/scripts/ask-peer.sh | reviewed |
| event-kernel host entry | tools/HME/event_kernel/host_hook_entry.js | reviewed |
| event-kernel adapters | tools/HME/event_kernel/host_adapter_common.js | reviewed |
| transcript compaction | tools/HME/proxy/transcript_compactor.js | pending |
| proxy request mutation | tools/HME/proxy/hme_proxy_request_mutation.js | pending |
| tool-result semantics | tools/HME/proxy/tool_result_semantics.js | pending |

## Notes
- "reviewed" surfaces carry their grounded fixes in git history (iterations 6-12
  and Phase 13). New fixes land in place; deeper refactors that would derail focus
  become their own TODO item.
- The map is updated as each round completes so B1 coverage stays auditable.
