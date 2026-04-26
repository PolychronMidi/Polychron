"""Model invocation + RAG context assembly."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import urllib.request

from ._base import (
    ENV, _SHIM_PORT, _ARBITER_MODEL, _CODER_MODEL, _REASONER_MODEL,
    _LLAMACPP_ARBITER_URL, _LLAMACPP_CODER_URL,
    _ARBITER_PORT, _CODER_PORT, _REASONER_PORT,
    _ARBITER_TIMEOUT, _REASONER_TIMEOUT, _TOTAL_TIMEOUT,
    _CODE_SIGNALS, _REASON_SIGNALS,
)

logger = logging.getLogger("HME.agent")


def _route_model(prompt: str) -> tuple[str, int, str]:
    """Pick coder vs reasoner based on query intent. Returns (model, port, label)."""
    words = set(prompt.lower().split())
    code_score = len(words & _CODE_SIGNALS)
    reason_score = len(words & _REASON_SIGNALS)
    if reason_score > code_score:
        return _REASONER_MODEL, _REASONER_PORT, "reasoner"
    if code_score > reason_score:
        return _CODER_MODEL, _CODER_PORT, "coder"
    # Tie or no signals — default to reasoner (broader capability)
    return _REASONER_MODEL, _REASONER_PORT, "reasoner"


def _infer_directories(prompt: str) -> list[str]:
    """Extract explicit path hints from the prompt so search scope matches
    what the user actually asked about. Without this, every query defaults
    to `src/` even when the prompt talks about `tools/HME/` or `doc/`."""
    dirs: list[str] = []
    lower = prompt.lower()
    # Direct path mentions — extract anything that looks like a / path
    for m in re.finditer(r'(?:^|[\s`])(tools/HME/\w*/?|src/\w*/?|doc/?|metrics/?|scripts/?|tmp/?|log/?)', prompt):
        p = m.group(1).rstrip("/") + "/"
        if p not in dirs:
            dirs.append(p)
    # Topical keyword → directory mapping
    if "hook" in lower or "pretooluse" in lower or "posttooluse" in lower or "sessionstart" in lower:
        if "tools/HME/hooks/" not in dirs:
            dirs.append("tools/HME/hooks/")
    if "mcp" in lower or "server" in lower or "llamacpp" in lower or "verifier" in lower or "onboard" in lower:
        if "tools/HME/mcp/" not in dirs:
            dirs.append("tools/HME/mcp/")
    if "chat" in lower or "typescript" in lower:
        if "tools/HME/chat/" not in dirs:
            dirs.append("tools/HME/chat/")
    if "skill" in lower:
        if "tools/HME/skills/" not in dirs:
            dirs.append("tools/HME/skills/")
    if "crosslayer" in lower or "cross-layer" in lower or "cross_layer" in lower:
        if "src/crossLayer/" not in dirs:
            dirs.append("src/crossLayer/")
    if "conductor" in lower or "signal" in lower or "coupling" in lower or "hypermeta" in lower:
        if "src/conductor/" not in dirs:
            dirs.append("src/conductor/")
    if "stutter" in lower or "fx" in lower:
        if "src/fx/" not in dirs:
            dirs.append("src/fx/")
    if "rhythm" in lower or "beat" in lower:
        if "src/rhythm/" not in dirs:
            dirs.append("src/rhythm/")
    if "doc" in lower or "readme" in lower or "claude.md" in lower:
        if "doc/" not in dirs:
            dirs.append("doc/")
    if "metrics" in lower or "journal" in lower:
        if "metrics/" not in dirs:
            dirs.append("metrics/")
    # Default fallback: if nothing matched, search src AND tools/HME so we
    # never accidentally scope away the audit target
    if not dirs:
        dirs = ["src/", "tools/HME/"]
    return dirs[:6]


def _strip_think(text: str) -> str:
    """Strip thinking tags + dedup."""
    from server.tools_analysis.synthesis.synthesis_config import strip_thinking_tags
    return _dedup_output(strip_thinking_tags(text))


def _dedup_output(text: str, max_repeats: int = 2) -> str:
    """Detect and truncate consecutive repetition loops in model output.

    Only removes lines that repeat consecutively — scattered mentions of the
    same string are kept. Fixes runaway loops (550 identical lines) without
    stripping legitimate repeated references.
    """
    lines = text.split("\n")
    if len(lines) < 6:
        return text
    kept = []
    truncated = 0
    run_line: str | None = None
    run_count = 0
    for line in lines:
        stripped = line.strip()
        if stripped == run_line:
            run_count += 1
        else:
            run_line = stripped
            run_count = 1
        if run_count <= max_repeats:
            kept.append(line)
        else:
            truncated += 1
    if truncated > 0:
        kept.append(f"\n[{truncated} repetitive lines removed]")
    return "\n".join(kept)


def _llamacpp_base_for(model: str) -> str:
    """Pick the right llama-server URL for a given model name."""
    if model == _ARBITER_MODEL:
        return _LLAMACPP_ARBITER_URL
    return _LLAMACPP_CODER_URL


def _call_model(prompt: str, model: str, port: int, system: str = "",
                max_tokens: int = 4096, temperature: float = 0.3, timeout: int = 180) -> str:
    """Unified model call with think-tag stripping.
    All dispatch uses llama-server /v1/chat/completions. The `port` argument
    is retained for legacy tuple shape but ignored — routing is by model name.
    """
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    payload = json.dumps({
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": False,
        "cache_prompt": True,
    }).encode()
    url = f"{_llamacpp_base_for(model)}/v1/chat/completions"
    req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read())
    choices = data.get("choices") or []
    if not choices:
        return ""
    msg = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
    text = (msg.get("content", "") or "").strip() if isinstance(msg, dict) else ""
    return _strip_think(text)


def _call_arbiter(prompt: str, system: str = "", max_tokens: int = 1024) -> str:
    return _call_model(prompt, _ARBITER_MODEL, _ARBITER_PORT,
                       system=system, max_tokens=max_tokens, temperature=0.0,
                       timeout=_ARBITER_TIMEOUT)


def _load_cascade_module():
    """Import synthesis_reasoning + sibling provider modules. In standalone
    agent_local invocation (pretooluse_agent.sh), ctx.mcp is None and the
    tools_analysis __init__'s @ctx.mcp.tool() decorators would crash; stub
    it with a no-op registry before the import so the package init can
    complete. Returns the cascade module or None on failure."""
    try:
        from server import context as _ctx
    except Exception as _e:
        logger.warning(f"cascade: cannot import server.context ({_e})")
        return None

    if _ctx.mcp is None:
        class _StubRegistry:
            def tool(self, **_kwargs):
                def deco(fn):
                    return fn
                return deco
            def __getattr__(self, _name):
                return self.tool
        _ctx.mcp = _StubRegistry()

    try:
        from server.tools_analysis.synthesis import synthesis_reasoning
        return synthesis_reasoning
    except Exception as _e:
        logger.warning(f"cascade module load failed: {type(_e).__name__}: {_e}")
        return None


_cascade_mod = None
_cascade_load_attempted = False


def _call_synthesizer(prompt: str, system: str = "", max_tokens: int = 4096,
                      query_prompt: str = "") -> tuple[str, str]:
    """Call the best-available model. Tries the free-API cascade first
    (synthesis_reasoning.call() — 22-slot ranked list with per-model circuit
    breakers across cerebras/groq/gemini/openrouter/mistral/nvidia), falling
    through to local llama-server only when every ranked slot is exhausted."""
    global _cascade_mod, _cascade_load_attempted
    model, port, local_label = _route_model(query_prompt or prompt)
    profile = "coder" if local_label == "coder" else "reasoning"
    if not _cascade_load_attempted:
        _cascade_mod = _load_cascade_module()
        _cascade_load_attempted = True
    if _cascade_mod is not None:
        try:
            cascade_out = _cascade_mod.call(
                prompt, system=system, max_tokens=max_tokens,
                temperature=0.3, profile=profile,
            )
            if cascade_out:
                # Prefer the fine-grained source the dispatcher now exposes
                # — distinguishes 'overdrive/opus' from '<provider>/<model>'
                # slots. Falls back to the generic cascade/<profile> label
                # when last_source() isn't implemented (older module).
                try:
                    src = _cascade_mod.last_source() or f"cascade/{profile}"
                except AttributeError:
                    src = f"cascade/{profile}"
                return _strip_think(cascade_out), src
        except Exception as _e:
            logger.warning(f"cascade dispatcher failed ({type(_e).__name__}: {_e}) — falling back to local")
    response = _call_model(prompt, model, port, system=system,
                           max_tokens=max_tokens, timeout=_REASONER_TIMEOUT)
    return response, local_label


def _get_rag_context(query: str) -> str:
    """Get RAG context from HME shim — KB entries + code search."""
    parts = []
    # KB search
    try:
        payload = json.dumps({"engine": "project", "method": "search_knowledge",
                              "kwargs": {"query": query, "top_k": 6}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{_SHIM_PORT}/rag",
                                    data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            kb = json.loads(resp.read()).get("result", [])
        if kb:
            parts.append("=== Knowledge Base ===")
            for r in kb[:6]:
                title = r.get("title", "")
                content = r.get("content", "")[:300]
                parts.append(f"- {title}: {content}")
    except Exception as _kb_err:
        logger.debug(f"agent_local KB context probe failed: {type(_kb_err).__name__}: {_kb_err}")
    # Code search
    try:
        payload = json.dumps({"engine": "project", "method": "search",
                              "kwargs": {"query": query, "top_k": 5}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{_SHIM_PORT}/rag",
                                    data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            code = json.loads(resp.read()).get("result", [])
        if code:
            parts.append("\n=== Relevant Code Chunks ===")
            for r in code[:5]:
                meta = r.get("metadata", {})
                path = meta.get("path", r.get("path", "?"))
                text = r.get("text", r.get("chunk", ""))[:200]
                if path != "?":
                    parts.append(f"- {path}: {text}")
    except Exception as _code_err:
        logger.debug(f"agent_local code-chunk probe failed: {type(_code_err).__name__}: {_code_err}")
    return "\n".join(parts) if parts else ""


