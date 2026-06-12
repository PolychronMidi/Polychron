"""Optional LangChain adapter for canonical HME smolagents tools.

This module is dependency-optional: importing it does not require LangChain.
Callers that have ``langchain_core`` installed can materialize real
``StructuredTool`` instances; otherwise use ``langchain_tool_descriptors`` for
schema/metadata interop.
"""
from __future__ import annotations

import inspect
from typing import Any, Callable

from pydantic import create_model

from .base import HMETool, langchain_tool_schema
from .tools import canonical_tools


def langchain_tool_descriptors() -> list[dict[str, Any]]:
    """Return dependency-free LangChain StructuredTool-compatible descriptors."""
    return [langchain_tool_schema(tool) for tool in canonical_tools()]


def _python_type(json_type: str | list[str] | None) -> type[Any]:
    if isinstance(json_type, list):
        non_null = [t for t in json_type if t != "null"]
        json_type = non_null[0] if non_null else None
    return {
        "string": str,
        "integer": int,
        "number": float,
        "boolean": bool,
        "array": list,
        "object": dict,
    }.get(str(json_type or "string"), Any)


def _args_model(tool: HMETool):
    schema = langchain_tool_schema(tool)["args_schema"]
    required = set(schema.get("required") or [])
    fields: dict[str, tuple[Any, Any]] = {}
    for name, spec in (schema.get("properties") or {}).items():
        typ = _python_type(spec.get("type"))
        default = ... if name in required else None
        fields[name] = (typ, default)
    return create_model(f"HME{tool.name}Args", **fields)


def _emit(telemetry: Callable[[dict[str, Any]], Any] | None, payload: dict[str, Any]) -> None:
    if telemetry is not None:
        telemetry(payload)


def _callable(tool: HMETool, *, executor: Any = None, telemetry: Callable[[dict[str, Any]], Any] | None = None) -> Callable[..., str]:
    def invoke(**kwargs: Any) -> str:
        _emit(telemetry, {"event": "hme_langchain_tool_invoked", "tool": tool.name})
        if executor is not None:
            if hasattr(executor, "invoke"):
                return str(executor.invoke(tool.name, kwargs, tool=tool))
            if callable(executor):
                return str(executor(tool.name, kwargs, tool=tool))
        return tool.forward(**kwargs)
    invoke.__name__ = f"hme_{tool.name}"
    invoke.__doc__ = tool.description
    return invoke


def _async_callable(tool: HMETool, *, executor: Any = None, telemetry: Callable[[dict[str, Any]], Any] | None = None) -> Callable[..., Any]:
    async def ainvoke(**kwargs: Any) -> str:
        _emit(telemetry, {"event": "hme_langchain_tool_invoked", "tool": tool.name, "async": True})
        if executor is not None:
            if hasattr(executor, "ainvoke"):
                return str(await executor.ainvoke(tool.name, kwargs, tool=tool))
            if hasattr(executor, "invoke"):
                value = executor.invoke(tool.name, kwargs, tool=tool)
                return str(await value) if inspect.isawaitable(value) else str(value)
            if callable(executor):
                value = executor(tool.name, kwargs, tool=tool)
                return str(await value) if inspect.isawaitable(value) else str(value)
        value = tool.forward(**kwargs)
        return str(await value) if inspect.isawaitable(value) else str(value)
    ainvoke.__name__ = f"hme_{tool.name}_async"
    ainvoke.__doc__ = tool.description
    return ainvoke


def create_langchain_tools(*, executor: Any = None, telemetry: Callable[[dict[str, Any]], Any] | None = None) -> list[Any]:
    """Create real LangChain StructuredTool objects when langchain_core exists.

    Raises:
        RuntimeError: when ``langchain_core`` is not installed.
    """
    try:
        from langchain_core.tools import StructuredTool
    except Exception as exc:  # pragma: no cover - depends on optional package
        raise RuntimeError("langchain_core is required to create StructuredTool instances") from exc

    out: list[Any] = []
    for tool in canonical_tools():
        out.append(
            StructuredTool.from_function(
                func=_callable(tool, executor=executor, telemetry=telemetry),
                coroutine=_async_callable(tool, executor=executor, telemetry=telemetry),
                name=tool.name,
                description=tool.description,
                args_schema=_args_model(tool),
                return_direct=False,
                metadata=tool.hme_metadata(),
            )
        )
    return out
