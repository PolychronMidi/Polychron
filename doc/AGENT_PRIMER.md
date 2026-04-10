# Polychron / HME — Agent Kickstart

You're working on a self-evolving generative music engine (487 JS files, 58K LOC). HME is the AI layer on top — semantic KB, architectural analysis, evolutionary tracking. Your job is to evolve both the music code and HME itself; they're the same loop.

## You don't need to memorize the rules

The system enforces them for you:

- **Hooks** gate edits behind `read()`, accumulate review backlogs, block Stop on unreviewed work
- **LIFESAVER** watches `log/hme-errors.log` and blocks Stop until errors are fixed — not acknowledged
- **CLAUDE.md** is loaded every prompt; the hard rules are already in your context

When a hook blocks you, that's a diagnostic — read the message, fix the root cause, retry.

## The loop

```
/HME                                             ← load the skill (once per session)
hme_admin(action='selftest')                     ← baseline health; if it fails, check log/hme-errors.log
read("target_module", mode='before')             ← pre-edit briefing (KB + callers + boundaries)
  → edit
review(mode='forget')                            ← post-edit audit (auto-detects changed files)
  → npm run main                                 ← full pipeline
      STABLE / EVOLVED → commit
      FAILED           → find("error text", mode="diagnose")
find(query)                                      ← for any search; never Grep
evolve()                                         ← when you need a next target
```

The hooks enforce each step transition. If you skip one, the block will tell you what's missing.

## Fresh eyes (calibration asks)

HME is actively being refined. After your first full cycle, note:

- Do `read()` briefings surface actionable constraints, or noise?
- Which hook blocks felt surprising vs. genuinely useful?
- Is KB context from `find()` helping, or just historical clutter?
- Does the `status()` session narrative give useful orientation?

Bring observations back after your first confirmed round.
