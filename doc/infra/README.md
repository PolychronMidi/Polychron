# Documentation Infrastructure

Tools that keep docs up to date without hand-maintained drift.

- `update_full_indexes.py` updates compact navigation indexes near the top of every `doc/**/*_full.md` file.

Run: `python3 doc/infra/update_full_indexes.py`
Check: `python3 doc/infra/update_full_indexes.py --check`
