"""Local model inference API -- _local_think, _local_chat, compress_for_claude.

Split from synthesis_llamacpp.py for maintainability. All functions here
use the core infrastructure (circuit breaker, daemon routing, env config)
from synthesis_llamacpp.
"""
import json
import os
import re
import logging
import threading as _threading

from server import context as ctx
from .synthesis_config import _THINK_SYSTEM
from .synthesis_llamacpp import (  # noqa: F401
    _get_circuit_breaker, _llamacpp_generate, _daemon_generate,
    _set_arbiter_busy, _llamacpp_url_for, _background_yield,
    _COOLDOWN_REFUSED, _KEEP_ALIVE, _NUM_CTX_4B,
    _LOCAL_MODEL, _REASONING_MODEL, _ARBITER_MODEL,
    _LLAMACPP_ARBITER_URL, _num_ctx_for,
    _interactive_event,
)
# synthesis_inference imports US at line 377 -- top-level back-import would
# partial-load. Lazy lookup at call time keeps bare-name resolution working.
def _PROSE_AND_KEYWORD_STOPWORDS():
    from . import synthesis_inference as _si
    return _si._PROSE_AND_KEYWORD_STOPWORDS

logger = logging.getLogger("HME")

# English prose + language-keyword stop-words used by extract_diff_symbols


def compress_for_claude(text: str, max_chars: int = 600, hint: str = "") -> str:
    """Compress verbose tool output via arbiter before returning to Claude's context window.

    Preserves: file paths (src/...), signal field names, module names, numbers, action verbs.
    Strips: prose preamble, redundant explanation, verbose 'why' sections.
    Falls back to truncation if arbiter unavailable or too slow.
    """
    if len(text) <= max_chars:
        return text
    import urllib.request
    from .synthesis_warm import _warm_ctx, _warm_ctx_fresh_p
    hint_prefix = f"Context: {hint}\n\n" if hint else ""
    prompt = (
        hint_prefix +
        f"Compress the following to <={max_chars} characters. "
        "Preserve: file paths (src/...), signal field names, module names, numbers, "
        "and concrete action verbs. Remove: prose preamble, redundant explanation, "
        "verbose 'why' sections that repeat what the action already implies. "
        "Output the compressed version ONLY -- no meta-commentary.\n\n"
        f"INPUT:\n{text[:4000]}"
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": max(200, max_chars // 2), "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
    if arbiter_ctx and _warm_ctx_fresh_p(_ARBITER_MODEL):
        payload["context"] = arbiter_ctx
    _cb = _get_circuit_breaker(_ARBITER_MODEL)
    if not _cb.allow():
        return text[:max_chars] + f"...(+{len(text) - max_chars} chars)"
    # Daemon-only: wall-clock enforced, no direct llama.cpp fallback.
    daemon_result = _daemon_generate(payload, wall_timeout=10)
    if daemon_result:
        from .synthesis_config import clean_model_output
        compressed = clean_model_output(daemon_result.get("response", ""))
        if compressed and len(compressed) < len(text):
            _cb.record_success()
            if len(compressed) > max_chars:
                return compressed[:max_chars] + f"...(+{len(compressed) - max_chars} chars)"
            return compressed
    return text[:max_chars] + f"...(+{len(text) - max_chars} chars)"


def filter_ungrounded_bullets(synthesis: str, source_text: str,
                              symbol_whitelist: set | None = None,
                              log_label: str = "synthesis") -> str:
    """Drop LLM synthesis bullets whose cited identifiers are not grounded
    in the source material. Generalization of workflow_audit's
    _drop_hallucinated_bullets -- any adaptive-synthesis call site can
    pipe its output through this filter to suppress the "correctly-cites-
    file, invents-symbol" hallucination class.

    Two layers:
      1. FILE PATHS -- must appear in source_text verbatim. Citing a file
         that isn't in the source is pure invention.
      2. BACKTICKED IDENTIFIERS -- each backticked token must appear in
         source_text OR in symbol_whitelist (arbiter-extracted set from
         extract_diff_symbols). Supports dotted-access component-wise
         check for `foo.bar.baz`.

    Bullets with zero refs (pure prose) pass. On parse error: return
    synthesis unchanged (fail-open, never make synthesis WORSE).
    """
    if not synthesis:
        return synthesis
    try:
        import re as _re
        source_blob = (source_text or "").lower()
        whitelist = {s.lower() for s in (symbol_whitelist or set())}
        lines = synthesis.split("\n")
        bullets: list[list[str]] = []
        current: list[str] = []
        bullet_head = _re.compile(
            r'^(?:\s*\*\*\d+\.|\s*\d+\.|\s*[-*]\s|\s*\*\*[A-Z][^*]*\*\*)'
        )
        for ln in lines:
            if bullet_head.match(ln) and current:
                bullets.append(current)
                current = [ln]
            else:
                current.append(ln)
        if current:
            bullets.append(current)

        path_re = _re.compile(r'[\w./-]+\.(?:js|ts|py|md|json|sh|yml|yaml|html)')
        tick_re = _re.compile(r'`([^`\n]{3,120})`')
        _log = logging.getLogger("HME")
        kept: list[str] = []
        for b in bullets:
            text = "\n".join(b)
            paths = [p.strip().lower() for p in path_re.findall(text) if p.strip()]
            ticks = [s.strip().lower() for s in tick_re.findall(text) if s.strip()]

            bad_paths = [p for p in paths if p not in source_blob]
            if bad_paths:
                _log.info(f"{log_label}: dropped bullet, unreferenced path(s) {bad_paths[:3]}")
                continue

            if ticks and (whitelist or source_blob.strip()):
                ungrounded = []
                for t in ticks:
                    bare = t.rstrip("()[]{},.;:!?")
                    if bare in source_blob or bare in whitelist:
                        continue
                    parts = [p for p in bare.split(".") if len(p) >= 3]
                    if parts and all(
                        (p in source_blob) or (p in whitelist) for p in parts
                    ):
                        continue
                    ungrounded.append(bare)
                if ungrounded:
                    _log.info(f"{log_label}: dropped bullet, ungrounded identifier(s) {ungrounded[:3]}")
                    continue
            kept.extend(b)
        filtered = "\n".join(kept).strip()
        return filtered if filtered else synthesis
    except Exception as _fe:
        logging.getLogger("HME").debug(
            f"filter_ungrounded_bullets: filter skipped: {type(_fe).__name__}: {_fe}"
        )
        return synthesis


def ground_synthesis(synthesis: str, source_text: str,
                     log_label: str = "synthesis") -> str:
    """One-shot convenience: extract symbols from source_text via arbiter
    (with regex fallback), then filter synthesis bullets against that
    whitelist + raw source. Use this at any adaptive-synthesis site that
    can hallucinate identifiers -- e.g. `diagnose_error`, `module_story`,
    `tools_knowledge` cluster analysis, `drama_map`, etc.

    Call shape: `synthesis = ground_synthesis(synthesis, source_text,
    log_label="diagnose_error")`.
    """
    if not synthesis or not source_text:
        return synthesis
    whitelist = extract_diff_symbols(source_text, "", "")
    return filter_ungrounded_bullets(synthesis, source_text,
                                     symbol_whitelist=whitelist,
                                     log_label=log_label)


def extract_diff_symbols(diff_context: str, hunk_context: str = "",
                         changed_files: str = "") -> set[str]:
    """Use the arbiter to enumerate identifiers that ACTUALLY appear in a
    diff, producing an authoritative whitelist for downstream grounding.

    Motivation: the reasoning model occasionally confabulates plausible-but-
    absent symbols inside a correctly-cited file (e.g. claims a Python
    script "uses pathlib.Path.glob()" when it actually uses os.walk, or
    calls `output_tokens` an "environment variable" when it's a JSON field).
    A path-citation filter alone can't catch these because the FILE path
    is real. Solving this by (a) asking the arbiter for a constrained
    extraction pass first, then (b) passing the whitelist into the reasoning
    prompt as a grounding constraint AND into the post-synthesis filter.

    Returns a lowercased set of candidate identifiers (function names,
    variable names, quoted strings, backticked tokens). Conservative: if
    the arbiter is unavailable or the output is unparseable, falls back to
    regex-based extraction over the raw diff so the downstream filter still
    has something to check against.
    """
    # Strip diff metadata BEFORE extraction so git noise doesn't pollute
    import re as _re_sx

    def _strip_diff_noise(raw: str) -> str:
        kept = []
        for ln in (raw or "").splitlines():
            if not ln:
                continue
            if ln.startswith(('diff --git', 'index ', '--- ', '+++ ',
                              '@@', 'Binary files', '\\ No newline')):
                continue
            if ln.startswith(('+', '-')):
                body = ln[1:]  # strip the +/- marker
                # Drop comment lines -- they're prose-heavy and would
                stripped = body.lstrip()
                if stripped.startswith(('#', '//', '/*', '*', '--')):
                    continue
                kept.append(body)
        return "\n".join(kept)

    diff_code_only = _strip_diff_noise(diff_context or "")
    source = "\n".join([changed_files or "", diff_code_only])
    if not source.strip():
        return set()

    # Regex-based fallback -- always produced, merged with arbiter output.
    fallback: set[str] = set()

    def _looks_identifier(tok: str) -> bool:
        # Reject stop-words + language keywords (English prose,
        if tok.lower() in _PROSE_AND_KEYWORD_STOPWORDS():
            return False
        # Drop regex-fragment / metadata noise: anything containing
        if any(c in tok for c in '\\[](){}<>^$|?*+=@'):
            return False
        # Drop pure-hex-looking git SHA fragments (7-40 hex chars, no
        # non-hex letters). Covers `fdd82f1d`, `7c169164`, `61c94716`.
        if 6 <= len(tok) <= 40 and all(c in '0123456789abcdef' for c in tok.lower()):
            return False
        return True

    # identifiers (snake_case, camelCase, dotted.access), 3+ chars
    for tok in _re_sx.findall(r'\b[A-Za-z_][A-Za-z0-9_.]{2,}\b', source):
        if _looks_identifier(tok):
            fallback.add(tok.lower())
    # code-shaped quoted strings only: reject anything containing a space
    # (those are prose sentences, not code literals like "utf-8" or ".env")
    for tok in _re_sx.findall(r'"([^"\n]{2,40})"|\'([^\'\n]{2,40})\'|`([^`\n]{2,40})`', source):
        for grp in tok:
            if grp and ' ' not in grp and _looks_identifier(grp.strip()):
                fallback.add(grp.strip().lower())
    # file paths (a/b/c.ext) -- strip git a/ b/ prefixes that survive
    # because changed_files and diff headers reference them.
    for tok in _re_sx.findall(r'[\w./-]+\.(?:js|ts|py|md|json|sh|yml|yaml|html)', source):
        _path = _re_sx.sub(r'^[ab]/', '', tok.lower())
        if _looks_identifier(_path):
            fallback.add(_path)

    # Arbiter pass -- augment with model-extracted symbols. Bounded prompt
    # size + temperature=0 keeps latency low and output deterministic.
    prompt = (
        "Extract every identifier that APPEARS VERBATIM in the following "
        "diff. Include: function names, variable names, file paths, quoted "
        "string literals, backticked tokens, config keys. One per line, no "
        "bullets, no prose, no explanation. Do NOT invent or normalize -- "
        "only tokens you can point to in the diff text. Cap output at 200 "
        "lines.\n\nDIFF:\n" + source[:6000]
    )
    payload = {
        "model": _ARBITER_MODEL, "prompt": prompt, "stream": False,
        "keep_alive": _KEEP_ALIVE,
        "options": {"temperature": 0.0, "num_predict": 600, "num_ctx": _NUM_CTX_4B},
    }
    arbiter_ctx = None
    try:
        # Pattern D fix consolidated into synthesis_warm._warm_ctx_fresh_p
        from .synthesis_warm import _warm_ctx, _warm_ctx_fresh_p
        arbiter_ctx = _warm_ctx.get(_ARBITER_MODEL)
        if arbiter_ctx and _warm_ctx_fresh_p(_ARBITER_MODEL):
            payload["context"] = arbiter_ctx
    except Exception as _wmerr:
        # silent-ok: optional fallback path.
        logging.getLogger("HME").debug(
            f"extract_diff_symbols: warm-ctx lookup skipped: {type(_wmerr).__name__}: {_wmerr}"
        )
    _cb = _get_circuit_breaker(_ARBITER_MODEL)
    if not _cb.allow():
        return {t for t in fallback if _looks_identifier(t)}
    daemon_result = _daemon_generate(payload, wall_timeout=8)
    if not daemon_result:
        return {t for t in fallback if _looks_identifier(t)}
    from .synthesis_config import clean_model_output
    raw = clean_model_output(daemon_result.get("response", "")) or ""
    _cb.record_success()
    extracted: set[str] = set()
    for ln in raw.splitlines():
        tok = ln.strip().strip("-** \t`\"'")
        if not tok or len(tok) < 3:
            continue
        # Reject outputs with spaces -- those are fabricated prose
        # ("a Python script", "the diff"), not identifiers.
        if " " in tok:
            continue
        # Apply the same structural filter as the fallback path. Without
        if not _looks_identifier(tok):
            continue
        extracted.add(tok.lower())
    # Final sweep: post-filter the UNION too, in case _looks_identifier
    # changes later or the fallback regex somehow accepted a stop-word.
    merged = {t for t in (fallback | extracted) if _looks_identifier(t)}
    return merged


