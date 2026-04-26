"""Generation proxy (llamacpp-shape → llama-server OpenAI-shape).

Translates legacy llamacpp /api/generate calls into llama-server
/v1/chat/completions, enforcing a hard wall-clock cap. Keeps HME's
older callers alive during the llama-server migration.
"""
from __future__ import annotations

import json
import threading
import urllib.request

from ._boot import logger
from .instance_spec import InstanceSpec
from .gpu_state import gpu_busy_set, gpu_busy_clear


def _resolve_base_url(model: str, instances: list[InstanceSpec]) -> str:
    """Map a model alias to the llama-server base URL that serves it.
    Falls back to first arbiter, then first instance, then localhost."""
    for spec in instances:
        if spec.alias == model:
            return spec.base_url()
    for spec in instances:
        if spec.name == "arbiter":
            return spec.base_url()
    return instances[0].base_url() if instances else "http://127.0.0.1:8080"


def _build_openai_payload(payload: dict) -> dict:
    """Translate incoming payload (llamacpp-style single-turn OR pre-built
    messages array) into OpenAI /v1/chat/completions shape. Top-level
    max_tokens/temperature override options.* equivalents."""
    if "messages" in payload:
        messages = payload["messages"]
    else:
        prompt = payload.get("prompt", "")
        system = payload.get("system") or None
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

    options = payload.get("options") or {}
    out = {"model": payload.get("model", ""), "messages": messages, "stream": False}
    # Top-level max_tokens / temperature take precedence over options.*
    if "max_tokens" in payload:
        out["max_tokens"] = int(payload["max_tokens"])
    elif "num_predict" in options:
        out["max_tokens"] = int(options["num_predict"])
    if "temperature" in payload:
        out["temperature"] = float(payload["temperature"])
    elif "temperature" in options:
        out["temperature"] = float(options["temperature"])
    if "top_p" in options:
        out["top_p"] = float(options["top_p"])
    if "stop" in options:
        out["stop"] = options["stop"]
    if "response_format" in payload:
        out["response_format"] = payload["response_format"]
    return out


def _generate_with_timeout(payload: dict, wall_timeout: float,
                           instances: list[InstanceSpec]) -> dict:
    """Translate llamacpp /api/generate request to llama-server OpenAI
    /v1/chat/completions and enforce a hard wall-clock cap.

    Returns llamacpp-shape response on success, {error, timeout?} on
    failure. Flips the per-GPU busy flag for the target instance's
    device so callers on that GPU (RAG / audio / etc.) route to CPU
    during the call.
    """
    model = payload.get("model", "")
    base = _resolve_base_url(model, instances)
    url = f"{base}/v1/chat/completions"
    body = json.dumps(_build_openai_payload(payload)).encode()
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"},
    )

    target_spec = next((s for s in instances if s.alias == model), None)
    busy_device = target_spec.device if target_spec is not None else None
    if busy_device is not None:
        gpu_busy_set(busy_device)

    result_box: list = [None, None]  # [response_dict, error_string]

    def _worker():
        try:
            with urllib.request.urlopen(req, timeout=wall_timeout) as resp:
                result_box[0] = json.loads(resp.read())
        except Exception as e:
            result_box[1] = f"{type(e).__name__}: {e}"

    t = threading.Thread(target=_worker, daemon=True)
    try:
        t.start()
        t.join(timeout=wall_timeout)
        if t.is_alive():
            logger.warning(f"/generate: wall timeout ({wall_timeout}s) for {model} at {url}")
            return {"error": f"wall timeout after {wall_timeout}s", "timeout": True}
        if result_box[1]:
            return {"error": result_box[1], "timeout": "timed out" in result_box[1].lower()}
        # Translate OpenAI response → llamacpp shape for legacy callers.
        resp_body = result_box[0] or {}
        choices = resp_body.get("choices") or []
        text = (choices[0].get("message") or {}).get("content", "") if choices else ""
        usage = resp_body.get("usage") or {}
        return {
            "model": model, "response": text, "done": True, "done_reason": "stop",
            "prompt_eval_count": usage.get("prompt_tokens", 0),
            "eval_count": usage.get("completion_tokens", 0),
            "total_duration": 0,
        }
    finally:
        if busy_device is not None:
            gpu_busy_clear(busy_device)
