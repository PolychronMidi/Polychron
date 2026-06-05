# Open design question for the HME team mesh

Decide the right CONTEXT MODEL for team peers. Two options, both implemented:

A. DISTINCT AGENT (context_mode=fresh, current default): each peer is a fresh
   `claude -p --session-id <new>` with a per-role `--append-system-prompt` charter
   and tools disallowed. The TASK must carry the artifact (via --context-file),
   else the peer honestly declines instead of inventing.
   - Pros: no identity contamination (a fresh agent never continues the driver's
     narration), fast (~9s), genuinely independent role voice, cheap.
   - Cons: zero inherited project context; only knows what the task carries; can't
     "remember" the wider session; grounding is the orchestrator's responsibility.

B. DRIVER FORK (context_mode=fork): peer is `claude --resume <driver> --fork-session`.
   - Pros: inherits the driver's FULL context (whole project + session).
   - Cons: a fork of the driver IS the driver -> on a meta-heavy transcript it
     continues the driver's narration / recognizes role-play and declines
     (observed contamination); heavier; slower; can drift into agentic re-explore.

Known facts from runs:
- Fresh distinct agents produced clean, uncontaminated, grounded reviews when the
  artifact was passed; they correctly DECLINED to invent when it was not.
- Forks produced one genuinely good adversarial round early, then contaminated
  (echoed driver narration) once the transcript filled with orchestration.

Question to resolve (decision-changing only):
1. Which model should be the DEFAULT, and WHEN (if ever) should the other be used?
2. What is the ONE missing mechanism that would make the chosen default reliably
   better than a single high-effort peer review (the baseline we must beat)?
3. Is a hybrid (fork for context-gathering crew, fresh for adversarial leads)
   worth the complexity, or is it a trap?
