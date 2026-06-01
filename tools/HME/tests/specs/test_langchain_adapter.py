from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / "tools" / "HME"))

import asyncio
import types

from hme_tools.langchain_adapter import create_langchain_tools, langchain_tool_descriptors  # noqa: E402


def test_langchain_descriptors_are_dependency_free_and_bare_named():
    descriptors = langchain_tool_descriptors()
    assert [tool["name"] for tool in descriptors] == ["Agent", "Bash", "Edit", "Read", "WebFetch", "WebSearch", "Write"]
    read = next(tool for tool in descriptors if tool["name"] == "Read")
    assert read["args_schema"]["type"] == "object"
    assert read["args_schema"]["additionalProperties"] is False
    assert read["args_schema"]["properties"]["file_path"]["type"] == "string"
    assert read["metadata"]["side_effect"] == "read"
    assert read["metadata"]["bridge_action"] == "read"
    assert read["return_direct"] is False


def test_create_langchain_tools_fails_loud_when_optional_dependency_missing():
    try:
        import langchain_core  # noqa: F401
    except Exception:
        try:
            create_langchain_tools()
        except RuntimeError as exc:
            assert "langchain_core" in str(exc)
        else:
            raise AssertionError("expected RuntimeError without langchain_core")


def test_create_langchain_tools_supports_executor_telemetry_and_async(monkeypatch):
    calls = []

    class FakeStructuredTool:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        @classmethod
        def from_function(cls, **kwargs):
            return cls(**kwargs)

    fake_tools = types.ModuleType("langchain_core.tools")
    fake_tools.StructuredTool = FakeStructuredTool
    fake_core = types.ModuleType("langchain_core")
    monkeypatch.setitem(sys.modules, "langchain_core", fake_core)
    monkeypatch.setitem(sys.modules, "langchain_core.tools", fake_tools)

    class Executor:
        def invoke(self, name, args, tool=None):
            calls.append(("invoke", name, args, tool.name if tool else None))
            return "sync-result"

        async def ainvoke(self, name, args, tool=None):
            calls.append(("ainvoke", name, args, tool.name if tool else None))
            return "async-result"

    telemetry = []
    tools = create_langchain_tools(executor=Executor(), telemetry=telemetry.append)
    read = next(tool for tool in tools if tool.kwargs["name"] == "Read")

    assert read.kwargs["func"](file_path="x") == "sync-result"
    assert asyncio.run(read.kwargs["coroutine"](file_path="x")) == "async-result"
    assert calls[0][:2] == ("invoke", "Read")
    assert calls[1][:2] == ("ainvoke", "Read")
    assert telemetry[0]["event"] == "hme_langchain_tool_invoked"
    assert telemetry[1]["async"] is True
