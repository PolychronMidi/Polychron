"""Single-writer lifecycle registry — formalizes which module owns what.

Every lifecycle domain has exactly ONE module authorized to perform writes
(spawn, kill, mutate persistent state). Read access is unrestricted; write
access is gated by `assert_writer(domain, module_name)`. Violations raise
RuntimeError — caller bugs surface at the point of misuse instead of as
downstream races (tonight's duplicate-supervisor bug was exactly this:
two modules thought they owned llama-server lifecycle).

Usage:

    from server.lifecycle_writers import assert_writer
    def spawn_llama_server(...):
        assert_writer("llama-server", "llamacpp_daemon")
        ...

Registered domains:

  llama-server       → llamacpp_daemon         (tools/HME/mcp/llamacpp_daemon/)
  embedders          → rag_engines             (tools/HME/mcp/rag_engines.py)
  kb                 → tools_knowledge         (tools/HME/mcp/server/tools_knowledge.py)
  conductor-state    → conductor subsystem     (src/conductor/*)
  cross-layer        → crossLayerEmissionGateway
  adaptive-state     → adaptive-state writer   (scripts/pipeline/*)
  hme-todo-store     → server.tools_analysis.todo
  lifesaver-registry → server.failure_genealogy

Adding a new domain: extend `_OWNERS` here and put `assert_writer(domain,
__name__.split('.')[-1])` at the top of every write function. Never two
domains pointing at the same module; never one domain pointing at two
modules.
"""
from __future__ import annotations

import logging

logger = logging.getLogger("HME")


# domain → authoritative writer module (short name). Name is matched via
# substring containment against the caller's __name__ so both flat and
# nested module layouts work (e.g. "llamacpp_daemon" matches when the
# caller is "llamacpp_daemon" OR "tools.HME.service.llamacpp_daemon").
# Keys are lifecycle-domain names; values are substrings that MUST appear
# in the caller's `__file__` (or `__name__`) for write permission. Keep
# values as bare module/file stems (not dotted paths) so they match both
# path forms — `.../server/tools_analysis/todo.py` AND a hypothetical
# `server.tools_analysis.todo` dotted import string.
_OWNERS: dict[str, str] = {
    "llama-server":        "llamacpp_daemon",
    "embedders":           "rag_engines",
    "kb":                  "tools_knowledge",
    "hme-todo-store":      "todo",
    "lifesaver-registry":  "failure_genealogy",
    "onboarding-state":    "onboarding_chain",
}


def register_owner(domain: str, writer: str) -> None:
    """Register (or override) the authoritative writer for a domain.
    Not idempotent — raises if `domain` is already registered to a
    different writer, to catch typo-driven conflicts at import time."""
    existing = _OWNERS.get(domain)
    if existing is not None and existing != writer:
        raise RuntimeError(
            f"lifecycle_writers: domain {domain!r} already owned by "
            f"{existing!r}; refusing silent override to {writer!r}. "
            f"If this is an intentional transfer, update _OWNERS directly."
        )
    _OWNERS[domain] = writer


def _caller_stems(caller: str) -> set[str]:
    """Return all plausible matchable stems from a caller identifier.
    Handles both file paths (`.../foo/bar.py`) and dotted module names
    (`foo.bar`) — extracts each path segment's basename without extension.
    Exact-match equality against `_OWNERS` values is stricter than
    substring containment (which e.g. would accept "todo_helpers" as
    matching "todo") and still works for both caller forms.
    """
    import os as _os
    stems: set[str] = set()
    # Path form: use basename sans extension.
    base = _os.path.basename(caller)
    if base:
        stems.add(_os.path.splitext(base)[0])
    # Dotted-module form: last segment is the module stem.
    if "." in caller and "/" not in caller and "\\" not in caller:
        stems.add(caller.rsplit(".", 1)[-1])
    # Bare identifier form: the whole string is a stem.
    if "/" not in caller and "\\" not in caller and "." not in caller:
        stems.add(caller)
    return stems


def assert_writer(domain: str, caller: str) -> None:
    """Raise RuntimeError if `caller` is not the registered writer for `domain`.

    Call this at the top of every mutation function in a domain. It turns
    cross-module lifecycle races into loud import-time / call-time errors
    instead of silent duplicate-work bugs.

    `caller` should be `__file__` (preferred — stable when a module is
    run as a script and __name__ becomes "__main__") OR a dotted module
    name like `server.tools_analysis.todo`. The matcher extracts the
    final path/module segment and compares to the registered owner
    exactly, so "todo.py" doesn't spuriously match "my_todo_helpers.py".
    """
    owner = _OWNERS.get(domain)
    if owner is None:
        raise RuntimeError(
            f"lifecycle_writers: unknown domain {domain!r}. Register it in "
            f"_OWNERS before calling assert_writer. Known domains: "
            f"{sorted(_OWNERS.keys())}"
        )
    if owner not in _caller_stems(caller):
        raise RuntimeError(
            f"lifecycle_writers: {caller!r} attempted to write domain "
            f"{domain!r} but only {owner!r} may do so. This is a "
            f"single-writer invariant violation — two modules mutating "
            f"the same lifecycle cause races (see tonight's duplicate "
            f"llamacpp_supervisor incident). Either route the write "
            f"through {owner!r}, or if the ownership model has truly "
            f"changed, update _OWNERS explicitly. Tip: pass __file__ "
            f"instead of __name__ when the caller runs as a script."
        )


def owner_of(domain: str) -> str | None:
    """Query which module owns a domain (for diagnostics / selftest probes)."""
    return _OWNERS.get(domain)


def all_domains() -> dict[str, str]:
    """Snapshot of the full ownership table."""
    return dict(_OWNERS)
