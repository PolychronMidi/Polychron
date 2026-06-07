# Documentation Infrastructure

Tools that keep docs up to date without hand-maintained drift. This README is directory intent only; canonical docs stay in `doc/self-coherence-full.md`.

- `update.py` runs all doc/infra maintenance commands.
- `update_full_indexes.py` updates compact navigation indexes near the top of every `doc/**/*_full.md` file.
- `update_self_coherence.py` updates generated machine-derived sections inside `doc/self-coherence-full.md`.

Run: `python3 doc/infra/update.py`
Check: `python3 doc/infra/update.py --check`

Autolinks: inline backtick paths that exist in `git ls-files` (plus tracked directories) become relative Markdown links.
