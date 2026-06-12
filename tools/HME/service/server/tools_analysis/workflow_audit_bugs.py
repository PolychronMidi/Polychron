"""HME post-edit audit tools -- what_did_i_forget and diagnose_error."""
import os
import logging

from server import context as ctx
from server.helpers import (
    get_context_budget, validate_project_path,
    BUDGET_LIMITS, CROSSLAYER_BOUNDARY_VIOLATIONS,
    KNOWN_L0_CHANNELS, DOC_UPDATE_TRIGGERS,
)
from symbols import find_callers as _find_callers
from .synthesis import _reasoning_think, _THINK_SYSTEM, _REVIEW_SYSTEM
from .synthesis_session import append_session_narrative
from .tool_cache import cached_kb_search, cached_find_callers
from . import _track

logger = logging.getLogger("HME")




def _scan_python_bug_patterns(rel_path: str, content: str) -> list[str]:
    """Heuristic scan for common Python bug patterns in HME server code.

    Checks for null-sentinel .get() traps, unguarded ValueError in OSError handlers,
    unbounded append-only file growth, `or` idioms that mask 0.0, and variable-before-
    assignment across guard boundaries.

    Self-exclusion: this scanner lives in workflow_audit.py and contains the
    patterns it looks for AS REGEX STRINGS. Scanning the scanner produces
    hits on those literals -- not real bugs. Skip.
    """
    if rel_path.endswith("workflow_audit.py"):
        return []
    import re
    warnings = []

    # 1. dict.get(key, non-None-default) used in a context where a returned
    null_sentinel = re.findall(
        r'\.get\(["\'][^"\']+["\'],\s*(?:0|time\.\w+\(\)|[0-9]+\.?[0-9]*)\)'
        r'\s*(?:[-+*/<>=]|[-+]=|!=)',
        content
    )
    if null_sentinel:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(null_sentinel)} .get(key, default) call(s) in "
            "arithmetic/comparison context -- silent fallback. "
            "If the key is always present, use `d[key]` (fail-fast). "
            "For legitimately-optional boundary inputs, use an explicit named "
            "check: `x = d.get(key); if x is None: x = default`. "
            "Do NOT swap to `.get(key) or X` -- that's the same silent fallback."
        )

    # 2. int()/float() conversion inside a try block that only catches OSError-family.
    for try_match in re.finditer(r'^(\s*)try:\s*$', content, flags=re.MULTILINE):
        indent = try_match.group(1)
        start = try_match.end()
        # Find the FIRST except at exactly the same indent as the try:.
        except_re = re.compile(
            rf'^{re.escape(indent)}except([^\n:]*):\s*$',
            flags=re.MULTILINE,
        )
        em = except_re.search(content, start)
        if em is None:
            continue
        try_body = content[start:em.start()]
        if not re.search(r'\bint\(|\bfloat\(', try_body):
            continue
        # exc_types = whatever is between `except` and `:`. Bare except
        exc_types = em.group(1).strip()
        has_os = "OSError" in exc_types or "JSONDecodeError" in exc_types
        has_value_or_type = "ValueError" in exc_types or "TypeError" in exc_types
        if has_os and not has_value_or_type:
            warnings.append(
                f"[{rel_path}] PYTHON: `except {exc_types}` around int()/float() "
                "conversion -- ValueError/TypeError not caught; "
                "malformed values will escape to the outer exception handler."
            )
            break  # one warning per file is enough

    # 3. Append-only file write without a corresponding trim/truncate.
    append_opens = re.findall(r'open\([^,)]+,\s*["\']a["\']\)', content)
    has_trim = bool(re.search(r'_trim_\w+|\.writelines\(.*\[truncate\(', content))
    if append_opens and not has_trim:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(append_opens)} append-only write(s) with no trim -- "
            "file will grow without bound over time."
        )

    zero_or = re.findall(r'\.get\([^)]+\)\s+or\s+(?:[0-9]+\.?[0-9]*|time\.\w+\(\))', content)
    if zero_or:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(zero_or)} `.get() or X` -- silent fallback. "
            "Returns fallback for 0, 0.0, and '' too, not just None. "
            "If the key is always present, use `d[key]` (fail-fast). "
            "For legitimately-optional boundary inputs, use an explicit named "
            "check: `x = d.get(key); if x is None: x = default`. "
            "Do NOT swap to `.get(key, X)` -- that's the same silent fallback."
        )

    # 5. Bare variable reference that might be used outside the `if` guard defining it.
    guarded = re.findall(r'if\s+len\([^)]+\)\s*>=\s*(\d+):[^\n]*\n(?:[ \t]+[^\n]+\n)*[ \t]+(\w+)\s*=', content)
    for _threshold, var in guarded:
        if content.count(f"\n    {var}") + content.count(f"\n        {var}") > 1:
            warnings.append(
                f"[{rel_path}] PYTHON: `{var}` assigned inside `if len() >= N` guard "
                "-- verify it's not referenced where the guard is False (NameError risk)."
            )

    # If the key is absent or stored as None, the subtraction raises TypeError.
    none_arith = re.findall(
        r'time\.(?:time|monotonic)\(\)\s*[-+]\s*\w+\.get\('
        r'|\w+\.get\([^)]+\)\s*[-+]\s*time\.(?:time|monotonic)\(\)',
        content
    )
    if none_arith:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(none_arith)} `time.time() +/- d.get(...)` -- "
            "if key is absent or None, arithmetic raises TypeError. "
            "Guard with `if d.get(key) is not None` or `(d.get(key) or 0.0)`."
        )

    # 7. except Exception: pass or bare except: pass -- silent catch-all.
    # These swallow all errors without logging, making bugs invisible in production.
    silent_except = re.findall(r'except\s+(?:Exception\s*)?:\s*pass\b', content)
    if silent_except:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(silent_except)} silent `except ... pass` -- "
            "swallows all errors. At minimum log the exception; "
            "narrow the type or re-raise if possible."
        )

    # 8. Attribute access directly on .get() result without a None guard.
    none_attr = re.findall(r'\.get\(["\'][^"\']+["\']\)\.[a-zA-Z_]', content)
    if none_attr:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(none_attr)} `.get(...).attribute` without None guard -- "
            "absent/None key raises AttributeError. Use `x = d.get(key); "
            "if x is None: ...` or ensure the key is guaranteed and use `d[key].attr`."
        )

    # 8b. Dispatcher-bypass: direct use of the `_shared_*` RAG model globals
    _bypass_pattern = re.compile(
        r'(?<!_)_shared_(?:model|code_model|reranker)(?:_cpu)?'
        r'\s*\.\s*(?:encode|predict|get_sentence_embedding_dimension|__call__)\b'
    )
    _bypass = _bypass_pattern.findall(content)
    if _bypass:
        warnings.append(
            f"[{rel_path}] PYTHON: {len(_bypass)} direct `_shared_*.encode/"
            "predict/...` call(s) -- bypasses _RagDispatcher + VramManager. "
            "Route through `engine.text_model` / `engine.code_model` / "
            "`engine.reranker` (or the `_*_router` locals in hme_http.py "
            "construction). Direct use blocks active-offload and ignores "
            "the daemon per-GPU busy flag."
        )

    # 9. Operator-swap evasion of the silent-fallback rule.
    try:
        import subprocess as _sp
        _diff = _sp.run(
            ["git", "diff", "HEAD", "--", rel_path],
            cwd=ctx.PROJECT_ROOT, capture_output=True, text=True, timeout=3,
        ).stdout
    except Exception as _e:
        logger.debug(f"git diff probe for {rel_path}: {type(_e).__name__}: {_e}")
        _diff = ""
    if _diff:
        _rm_comma = re.findall(
            r'^-[^\n]*\.get\((["\'][^"\']+["\']),\s*([^)]+)\)',
            _diff, re.M,
        )
        _add_or = re.findall(
            r'^\+[^\n]*\.get\((["\'][^"\']+["\'])\)\s+or\s+(\S+)',
            _diff, re.M,
        )
        _rm_or = re.findall(
            r'^-[^\n]*\.get\((["\'][^"\']+["\'])\)\s+or\s+(\S+)',
            _diff, re.M,
        )
        _add_comma = re.findall(
            r'^\+[^\n]*\.get\((["\'][^"\']+["\']),\s*([^)]+)\)',
            _diff, re.M,
        )
        _swap_hits = []
        for (rk, _) in _rm_comma:
            for (ak, _) in _add_or:
                if rk == ak:
                    _swap_hits.append(rk)
                    break
        for (rk, _) in _rm_or:
            for (ak, _) in _add_comma:
                if rk == ak:
                    _swap_hits.append(rk)
                    break
        if _swap_hits:
            warnings.append(
                f"[{rel_path}] PYTHON: {len(_swap_hits)} operator-swap evasion(s) "
                f"on key(s) {sorted(set(_swap_hits))} -- "
                "`.get(key, X)` and `.get(key) or X` are the SAME silent fallback "
                "in different shapes. Swapping the operator to dodge one rule while "
                "tripping the other is rule-gaming, not fixing. "
                "Use `d[key]` to fail-fast, or `x = d.get(key); if x is None: ...` "
                "for legitimately-optional boundary inputs."
            )

    return warnings


