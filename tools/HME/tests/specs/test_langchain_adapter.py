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
