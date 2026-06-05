# Context model for team peers (SETTLED)

Team peers run as DRIVER FORKS WITH FULL TOOL ACCESS. This is the standing
directive, not an open question.

## The model
- context_mode = fork (default for every role). Each peer is
  `claude --resume <driver_session> --fork-session`, so it inherits the driver's
  FULL context (whole project + live session) instead of starting context-blank.
- FULL tool use. Peers keep Read/Grep/Glob/Bash/Edit/Write/etc. so they can
  VERIFY against the live tree instead of fabricating answers from thin air.
- Tool filtering, where ever wanted, is enforced centrally at the proxy via
  HME_FILTER_TOOLS_DROP. ask-peer does NOT keep its own disallow list.
- A peer that already has its own session resumes it (--resume <peer_sid>), so a
  multi-turn debate keeps memory; the first turn forks the driver.

## Why (and why the earlier "fresh distinct agent" design was wrong)
- Nuking context (fresh blank sessions) + blocking tools left peers with neither
  the project context NOR the ability to check anything -> they fabricated. That
  is the exact failure this directive forbids.
- A fork carries the real context; full tools let it confirm claims against the
  actual code. That is what makes peer review worth more than a single reviewer.

## Driver session id
- The guard pins HME_DRIVER_SESSION_ID for every routed peer (from the env or the
  transcript marker) so forks always attach to the live driver session.
- context_mode=fork with no resolvable driver session id FAILS CLOSED (error),
  rather than silently degrading to a blank session.
