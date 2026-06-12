# teams/

Bounded point-to-point team channels and role registry.
`roles.json` is tracked; `*.md` channels are ignored, tail-capped transcripts.
No broadcast channels; dispatch stays explicit and leashed.

Peer context model (settled): peers run as DRIVER FORKS with FULL tool access
(`claude --resume <driver_session> --fork-session`), so each inherits the
driver's full context and can VERIFY against the live tree instead of fabricating.
Tool filtering, where wanted, is centralized at the proxy (HME_FILTER_TOOLS_DROP);
ask-peer keeps no disallow list. context_mode=fork with no resolvable driver
session id FAILS CLOSED. Review briefs are DATA (`teams/rounds/review-briefs.json`)
composed into a peer MESSAGE at dispatch -- never committed capsule files.
