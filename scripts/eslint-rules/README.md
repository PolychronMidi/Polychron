# ESLint rules

Custom ESLint rules that enforce the architectural invariants from `CLAUDE.md` at lint time. Every rule here has a specific local reason — most exist because we were burned by the exact antipattern they now block. Rules are registered in `index.js` and referenced as `local/<rule-name>` from `.eslintrc.js`.

Each rule follows the standard ESLint rule shape: `meta` (docs, type, schema) + `create(context)` returning a visitor. Keep rules focused — one rule = one invariant. Rules that try to do two things end up catching neither well.

## Categories

- **Architectural boundaries** — `no-direct-conductor-state-from-crosslayer`, `no-direct-crosslayer-write-from-conductor`, `no-direct-coupling-matrix-read`, `no-conductor-registration-from-crosslayer`
- **Communication contracts** — `no-bare-l0-channel`, `no-direct-signal-read`, `no-direct-buffer-push-from-crosslayer`, `no-unregistered-feedback-loop`
- **Fail-fast enforcement** — `no-silent-early-return`, `no-empty-catch`, `only-error-throws`, `no-doubled-fallback`, `no-or-fallback-on-config-read`, `prefer-validator`, `no-unstamped-validator`
- **Globals discipline** — `no-typeof-validated-global`, `no-math-random`, `no-bare-math`, `no-requires-outside-index`
- **Cosmetics / drift** — `case-conventions`, `no-non-ascii`, `no-console-acceptable-warning`, `no-useless-expose-dependencies-comments`, `validator-name-matches-filename`

## Python parity

A subset of these rules has a Python equivalent in `tools/HME/scripts/check-*.py`, registered as invariants under `tools/HME/config/invariants.json`:

| ESLint rule | Python invariant | Notes |
|-------------|------------------|-------|
| `no-empty-catch` | `hme-py-no-silent-catchall` | `except Exception: pass` (R33 sibling) |
| `no-silent-early-return` | `hme-py-no-silent-fallback` | `except Exception: return []/None/False/...` without a `logger.*` call first. R33 class of bug. |
| `no-non-ascii` | `hme-py-no-non-ascii` | Allowlist includes em-dash, arrows, box-drawing, Greek, sparklines; blocks NBSP, curly quotes, zero-width spaces |
| `no-doubled-fallback` | `hme-py-no-doubled-fallback` | `dict.get(k, DEFAULT) or X` — silently coerces legit falsy values |
| `no-or-fallback-on-config-read` | `hme-py-no-raw-os-environ` (partial) | Covered by forcing `ENV.get()` helper instead of `os.environ.get(X) or default` |
| `only-error-throws` | — | Not ported: Python's `raise` already restricts to exception types |
| `case-conventions` | — | Python has PEP8 (snake_case); enforced by Python tooling conventions |
| `no-math-random`, `no-bare-math` | — | JS-only (no Math global in Python) |
| `no-requires-outside-index`, `no-bare-l0-channel`, `no-direct-*` | — | JS composition-engine architecture rules |

Pattern: JS-side rules enforced at lint time; Python-side rules enforced by the invariant battery. Both are first-class — neither is fallback for the other.

## Adding a rule

1. Write `<rule-name>.js` with `meta` + `create` exports
2. Register in `index.js`
3. Enable in `.eslintrc.js` under `rules: { 'local/<rule-name>': 'error' }`
4. Document the reason in the rule's `meta.docs.description` — future readers need to know WHY it exists
5. If the rule has a Python analog (e.g. concerns silent failure, ASCII hygiene, fallback patterns), also add `check-py-<rule>.py` and register in `invariants.json` — update the Python parity table above

<!-- HME-DIR-INTENT
rules:
  - One rule = one invariant; rules that try to enforce multiple things catch none of them well
  - Every rule's `meta.docs.description` MUST explain the incident or invariant that motivated it — future readers need the WHY
  - New rules are enabled in `.eslintrc.js` under `local/<rule-name>`; unregistered rules are dead code
  - Rules run at lint time only — runtime enforcement of the same invariant goes in the module, not here
-->
