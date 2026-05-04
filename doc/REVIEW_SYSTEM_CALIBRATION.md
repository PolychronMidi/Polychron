# Review-system prompt calibration notes

Source-of-truth for the design rationale behind `_REVIEW_SYSTEM` and
`_PARTNER_SYSTEM` in
`tools/HME/service/server/tools_analysis/synthesis/synthesis_config.py`.
Inline comments there were trimmed to satisfy CLAUDE.md ("Inline comments
single-line and terse"); full rationale lives here.

## `_REVIEW_SYSTEM` — forensic auditor

Calibrated against patterns that produced real-bug signal vs hallucination
during the 100-iteration sweep across the HME codebase.

Empirical findings on what extracts useful signal from the persistent
Opus thread (and likely from any sufficiently-capable reviewer LLM):

- **PERMISSION TO CLEAR.** Prompts that explicitly allow "clean" / "no
  tier-1 issues" / "95%+ confidence only" produced calibrated honest
  answers. Prompts that read as "find the worst..." returned
  finding-shaped text regardless of whether bugs existed.

- **QUOTE-GROUND.** Requiring the reviewer to QUOTE the suspicious line
  verbatim before reasoning about it dramatically reduces line-number
  hallucination. "Cite file:line" alone wasn't enough — the reviewer
  would invent the line content. "Quote the line + explain why" works.

- **PROMISE-VS-DELIVERS.** The strongest single framing was "compare the
  file's docstring/comments to its actual behavior — find divergence."
  Three real divergences in `cascade_analysis.py`, two in
  `posttooluse_hme_review.sh`, all confirmed.

- **TIER-GATED.** "Tier-1 (confirmed bug) only" produced honest "no
  tier-1 issues found" responses on clean files. Without the tier gate,
  every prompt produced a vector regardless of code quality.

- **LEADING PROMPTS POISON SIGNAL.** "Find the worst non-obvious failure
  mode" or "Find code that's clever enough to obscure a subtle bug"
  consistently produced low-confidence inventions. The reviewer
  pattern-matches the framing, not the code.

The system prompt bakes those positive patterns in. Per-call user
prompts can still narrow the focus, but the framing in
`_REVIEW_SYSTEM` makes "clean" a first-class answer and grounds every
claim.

### Why no >=95%-confidence floor

A prior iteration used a >=95%-confidence floor. Self-reported LM
confidence is unmeasurable, and that framing pushed toward silence on
exactly the subtle contract/promise divergences this reviewer exists to
catch (peer-review iter 105 caught this as an asymmetric-reward problem:
cheap to stay silent, costly to defend a 70-90% finding that's actually
correct). The replacement test is STRUCTURAL: if you can quote a line
AND state a specific divergence it creates, flag it. Quote+divergence is
a binary gate a reviewer CAN reliably answer.

## `_PARTNER_SYSTEM` — partner reviewer

Complementary to `_REVIEW_SYSTEM`. Peer-review iter 144 identified that
the forensic register cannot perform six human cognitive operations:
aesthetic judgment, future-maintainer empathy, sustained puzzlement,
suspicion of design intent, affection for elegant code, asking "should
this exist." Forensic review is good at what it does — quote-grounded
tier-1 findings — but it's structurally cold, and the codebase's
cultural and aesthetic dimensions degrade silently along axes forensic
review can't even attempt to police.

The partner prompt does NOT compete with `_REVIEW_SYSTEM`; it's invoked
separately (e.g. `i/review mode=partner` once that routing exists) so
partner-review output doesn't dilute or contradict forensic findings.

Concrete misses this register would have caught (per iter 144):
- `psycho_stop.py`'s adversarial vocabulary in a permanent codebase
  artifact
- file lengths suggesting structural issues before specific bugs
- load-bearing comments / filename puns / error-message personality
  that should be preserved across refactors
- the aesthetic gestalt of a function that's symmetric in shape vs one
  that's misshapen-suggesting-broken
