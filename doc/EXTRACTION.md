# Extracting helpers across files

When LOC pressure forces a file split, the extracted child commonly
references symbols still in the parent (or vice versa) by bare name.
Python's late-binding lets that "work" at runtime if the load order
happens to be parent-first -- but it explodes when the child is loaded
first, when the parent is invoked as `__main__`, or when bytecode is
cached against a partially-loaded module. Every "worker is unresponsive"
incident in this repo so far has traced back to one of those three modes.

This doc lays out the patterns that work and the ones that don't, so
the next extraction doesn't reintroduce the same class of bug.

## The setup

A common shape that *looks* fine and *isn't*:

    # parent.py
    from .child import _do_thing                       # bottom-of-file
    A = "hello"                                        # top-of-file

    # child.py
    def _do_thing():
        return A.upper()                               # bare name from parent

This works **only** if `parent` is imported first. Run `python -c
"import child"` and you get `NameError: A is not defined` because Python
binds names at lookup time and `child`'s globals never had `A`.

## The patterns that work

### 1. One-way data flow -> top-level import

If parent has constants/helpers child needs, and child has nothing parent
needs, just import them at child's top:

    # child.py
    from .parent_helpers import A
    def _do_thing():
        return A.upper()

If parent legitimately needs to re-export `_do_thing` for backwards-
compat, keep the bottom import in parent -- that's safe because by the
time line 200 of parent runs, lines 1-199 have already bound parent's
own symbols, so child's `from .parent_helpers import A` finds it.

This is the default pattern -- use it when you can.

### 2. Mutual references -> lazy module-attribute access

When parent and child genuinely each reference symbols from the other,
top-level back-imports cycle. Use lazy module attribute access at call
time:

    # child.py -- no top-level import of parent
    def _do_thing():
        from . import parent
        return parent.A.upper()

The cost: an extra dict lookup per call (negligible). The win: works
under any load order, parent invoked as `__main__`, partial loads
during reload, or any combination.

### 3. Mutable shared state -> import the holder, not the binding

If parent owns a mutable container (`_state: dict = {}`) and child
mutates it, importing `_state` once is fine -- it's a pointer to the
container, not a snapshot. **But** if parent later reassigns
(`_state = {...}` or `init()` overwrites a path string), child's
binding goes stale. For values reassigned after init, prefer:

    # child.py
    from . import parent
    def use():
        return parent.SESSIONS_FILE  # read live

instead of `from .parent import SESSIONS_FILE` (which captures the
empty default at import time and never updates).

This was the actual bug class in `operational_state_recovery.py`: it
pre-imported `_SESSIONS_FILE` (set by `init()`) at top level, so every
recorder method read the empty string forever.

## The patterns that don't work

### Anti-pattern: top-level back-import

    # child.py
    from .parent import A             # <- top-level
    def _do_thing(): return A.upper()

    # parent.py
    A = "hello"
    from .child import _do_thing      # <- bottom-level

Loading parent first works. Loading child first cycles. CI doesn't
notice because tests usually trigger one specific load order. Production
crash that bit us 2026-05-01: worker.py was the entry point, but a
sibling module imported `worker_handler` directly during initialization,
loading the child first and crashing on every request.

### Anti-pattern: shim-class that pretends to be the value

    _SESSIONS_FILE = _LazyConst("_SESSIONS_FILE")

Cute, complex, and `_LazyConst` has to delegate every dunder the value
type might need (`__str__`, `__fspath__`, `__truediv__`, `__hash__`,
`__eq__`...). One missing dunder = silent failure. Just use `parent.X`
at the call site instead.

### Anti-pattern: parent has hyphens in its filename

    # parent's filename: audit-shell-undefined-vars.py
    # -> can't be imported as `audit-shell-undefined-vars`
    # -> child can't `from audit-shell-undefined-vars import _strip`

Fix: rename the parent to use underscores. Update string-form callers
(`os.path.join("scripts", "X.py")`) at the same time. The Python
identifier rule isn't optional -- every workaround for it is more
complex than the rename.

## When in doubt

Run `python3 scripts/audit-python-undefined-names.py` after any split.
It walks the AST and flags `Name(Load)` references that no scope binds.
Every `_safety.sh`-class extraction bug we've ever shipped in this repo
shows up there as a one-liner.
