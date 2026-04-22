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

The authoritative concordance map lives in [`tools/HME/config/invariants.json`](../../tools/HME/config/invariants.json) under the top-level `_js_rules.rules` array. Each entry names an ESLint rule with one of three statuses:

- **`ported`** — has a Python equivalent registered as an invariant; the entry names the `python_invariant` id. Scripts live in `tools/HME/scripts/check-*.py`.
- **`js_only`** — architecturally JS-specific (composition engine boundaries, CommonJS load order, JS globals, validator stamp chain) with no Python surface to enforce against.
- **`conventions_cover`** — partially covered by an existing Python invariant or by language/tooling conventions (PEP8, `raise` semantics); a strict port would be noisy or redundant.

The `eslint-concordance-complete` invariant validates the map every battery run: every file in this directory must appear in `_js_rules.rules`, every `ported` entry must name a real invariant id, and no entry may point to a deleted rule file. Ported Python invariants also carry a `js_equivalent` backlink field. Add a rule on either side → update `_js_rules` in the same change or the battery fails.

Pattern: JS-side rules enforced at lint time; Python-side rules enforced by the invariant battery. Both are first-class — neither is fallback for the other.

## Adding a rule

1. Write `<rule-name>.js` with `meta` + `create` exports
2. Register in `index.js`
3. Enable in `.eslintrc.js` under `rules: { 'local/<rule-name>': 'error' }`
4. Document the reason in the rule's `meta.docs.description` — future readers need to know WHY it exists
5. Add an entry to `_js_rules.rules` in `tools/HME/config/invariants.json` with the appropriate status (`ported`, `js_only`, or `conventions_cover`). If ported, also add `check-py-<rule>.py`, register a Python invariant with a `js_equivalent: "<rule-name>"` backlink, and point the entry's `python_invariant` field at its id. The `eslint-concordance-complete` invariant will fail if this step is skipped.

<!-- HME-DIR-INTENT
rules:
  - One rule = one invariant; rules that try to enforce multiple things catch none of them well
  - Every rule's `meta.docs.description` MUST explain the incident or invariant that motivated it — future readers need the WHY
  - New rules are enabled in `.eslintrc.js` under `local/<rule-name>`; unregistered rules are dead code
  - Rules run at lint time only — runtime enforcement of the same invariant goes in the module, not here
-->
