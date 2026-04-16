"""Tool registry — dict-backed replacement for FastMCP's @mcp.tool() decorator.

Keeps the decorator syntax (`@ctx.mcp.tool()`) so every existing tool_*.py
module works without modification. Wraps each registered function with the
same logging/LIFESAVER/self-narration banner chain that _LoggingMCP applied,
and extracts a JSON schema from the function signature for tools/list.

This file is the heart of the FastMCP removal: once every @mcp.tool() call
lands here instead of in FastMCP, there is no FastMCP dependency at all.
"""
import functools
import inspect
import logging
import time

logger = logging.getLogger("HME")

# name → {"fn": wrapped callable, "schema": JSON schema dict}
_TOOLS: dict = {}

_TYPE_MAP = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    list: "array",
    dict: "object",
}


def _schema_for(fn) -> dict:
    """Derive an MCP-style inputSchema from the function signature + docstring."""
    sig = inspect.signature(fn)
    doc = inspect.getdoc(fn) or ""
    description = doc.strip() or fn.__name__
    props: dict = {}
    required: list = []
    for pname, param in sig.parameters.items():
        if pname in ("self", "cls"):
            continue
        ann = param.annotation
        json_type = _TYPE_MAP.get(ann, "string")
        prop: dict = {"type": json_type}
        if param.default is inspect.Parameter.empty:
            required.append(pname)
        else:
            prop["default"] = param.default
        props[pname] = prop
    schema: dict = {
        "name": fn.__name__,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": props,
        },
    }
    if required:
        schema["inputSchema"]["required"] = required
    return schema


class Registry:
    """Drop-in replacement for FastMCP _LoggingMCP. `@registry.tool()` registers
    into the module-level `_TOOLS` dict instead of into FastMCP."""

    def tool(self, **_kwargs):
        def wrapper(fn):
            @functools.wraps(fn)
            def logged(*args, **kwargs):
                # Reset non-HME streak marker (matches _LoggingMCP behavior).
                try:
                    with open("/tmp/hme-non-hme-streak.count", "w") as _f:
                        _f.write("0")
                except OSError:
                    pass
                name = fn.__name__
                t0 = time.time()
                try:
                    result = fn(*args, **kwargs)
                    elapsed = time.time() - t0
                    if result is None:
                        logger.error(f"ERR  {name} returned None — tool must return a string")
                        result = f"Error: {name} returned None (bug in tool implementation)"
                    # Layer 2: tool response EMA
                    try:
                        from server import operational_state as ops
                        ops.update_ema("tool_response_ms_ema", elapsed * 1000)
                    except (ImportError, AttributeError) as _ema_err:
                        logger.debug(f"operational_state EMA update unavailable: {_ema_err}")
                    logger.info(f"RESP {name} [{elapsed:.1f}s] {str(result)[:200]}")
                    # Layer 4: drain queued LIFESAVER failures
                    from server.context import drain_critical_failures, is_degraded
                    lifesaver_banner = drain_critical_failures()
                    if lifesaver_banner:
                        result = lifesaver_banner + str(result)
                    # Layer 6: self-narration
                    try:
                        from server import self_narration as sn
                        narration = sn.build_status_narrative()
                        if narration:
                            result = narration + str(result)
                    except Exception as _err:
                        logger.debug(f"narration failed: {type(_err).__name__}: {_err}")
                        if is_degraded():
                            result = "[DEGRADED] RAG proxy unhealthy — shim may be restarting.\n" + str(result)
                    return result
                except Exception as e:
                    import traceback as _tb
                    elapsed = time.time() - t0
                    logger.error(f"ERR  {name} [{elapsed:.1f}s] {e}\n{_tb.format_exc()}")
                    raise

            _TOOLS[fn.__name__] = {"fn": logged, "schema": _schema_for(fn)}
            return logged
        return wrapper

    # FastMCP had other methods; none are used by tool modules today, but keep
    # __getattr__ as a no-op fallback so stray references don't crash.
    def __getattr__(self, name):
        raise AttributeError(f"Registry has no attribute '{name}' — FastMCP compatibility stub")


def call(name: str, args: dict):
    """Invoke a registered tool by name. Returns whatever the tool returns."""
    entry = _TOOLS.get(name)
    if not entry:
        raise KeyError(f"tool not registered: {name}")
    return entry["fn"](**(args or {}))


def list_schemas() -> list:
    """Return the MCP tools/list payload (list of tool schema dicts)."""
    return [entry["schema"] for entry in _TOOLS.values()]


def names() -> list:
    return list(_TOOLS.keys())
