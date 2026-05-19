"""Canonical HME tools as smolagents Tool subclasses."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Any

from .base import HMETool

ROOT = Path(os.environ.get("PROJECT_ROOT") or Path(__file__).resolve().parents[2])
SOURCE_ROOT = Path(os.environ.get("HME_SOURCE_ROOT") or Path(__file__).resolve().parents[2])
STRUCTURED_TOOL = SOURCE_ROOT / "tools" / "HME" / "scripts" / "codex_structured_tool.js"

DESTRUCTIVE_BASH_RE = re.compile(
    r"(^|[;&|]\s*)(rm|unlink|shred|truncate)\b"
    r"|\b(git\s+(reset\s+--hard|clean\s+-[fdx]|checkout\s+[^\n]*--|push\s+(--force|-f)|rebase|filter-branch))\b"
    r"|\b(chmod\s+-R|chown\s+-R|dd\s+if=|mkfs|mount|umount)\b"
)

EMPTY_BASH_TOOL_RESULT = "\n".join(
    [
        "HME adapter notice: ignored an empty Bash tool call because no command was provided.",
        "This notice is not task context and should not be treated as the user request.",
        "Continue from the latest user request/session objective; do not ask the user to resend context solely because of this adapter notice.",
    ]
)


def _run_node_action(action: str, payload: dict[str, Any], timeout: int = 120_000) -> str:
    proc = subprocess.run(
        ["node", str(STRUCTURED_TOOL), action, "--json"],
        input=_json(payload),
        text=True,
        capture_output=True,
        cwd=str(ROOT),
        timeout=timeout / 1000,
        env={**os.environ, "PROJECT_ROOT": str(ROOT)},
        check=False,
    )
    out = proc.stdout if proc.returncode == 0 else f"{proc.stdout}{proc.stderr}"
    return out.rstrip("\n")


def _json(value: dict[str, Any]) -> str:
    import json

    return json.dumps(value, ensure_ascii=False)


class AgentTool(HMETool):
    name = "Agent"
    description = 'Run a subagent. Example: Agent level=3 prompt="Audit parser edge cases." Use level 1-5: 1 tiny, 2 focused, 3 standard, 4 deep, 5 principal.'
    inputs = {
        "level": {"type": "integer", "description": "Effort level 1-5."},
        "prompt": {"type": "string", "description": "Focused task for the agent."},
    }
    output_type = "string"
    side_effect = "agent"
    approval = "never"
    idempotent = False
    input_aliases = {}
    passthrough_target = "exec_command"
    bridge_action = "agent"
    host_native = False
    visibility = {"progress_label": "Agent level={level}", "result_summary": "bytes"}

    def forward(self, level: int, prompt: str) -> str:
        return _run_node_action("agent", {"level": int(level), "prompt": prompt})


class BashTool(HMETool):
    name = "Bash"
    description = "Run a bash command and return output. Prefer Read/Edit/Write for file ops. Quote paths with spaces. Use absolute paths; avoid cd unless requested. Use timeout for long commands. Use run_in_background only when notification is enough. Never run destructive git/gh or bypass hooks unless explicitly requested."
    inputs = {
        "command": {"type": "string", "description": "The command to execute."},
        "timeout": {"type": "number", "description": "Optional timeout in milliseconds (max 600000).", "nullable": True},
        "description": {"type": "string", "description": "Brief active-voice description of what this command does.", "nullable": True},
        "run_in_background": {"type": "boolean", "description": "Set true to run in the background.", "nullable": True},
    }
    output_type = "string"
    side_effect = "shell"
    approval = "destructive"
    idempotent = False
    input_aliases = {"command": ["cmd"]}
    passthrough_target = "exec_command"
    bridge_action = "bash"
    host_native = False
    visibility = {"progress_label": "Bash {description}", "result_summary": "bytes"}
    policy = {"max_timeout_ms": 600_000, "bare_name_required": True}

    def requires_approval(self, payload: dict[str, Any]) -> bool:
        return bool(DESTRUCTIVE_BASH_RE.search(str(payload.get("command") or payload.get("cmd") or "")))

    def forward(self, command: str, timeout: float | None = None, description: str | None = None, run_in_background: bool | None = None) -> str:
        del description, run_in_background
        if not command.strip():
            return EMPTY_BASH_TOOL_RESULT
        proc = subprocess.run(
            ["bash", "-lc", command],
            text=True,
            capture_output=True,
            cwd=str(ROOT),
            timeout=min(max(float(timeout or 120_000), 1), 600_000) / 1000,
            env={**os.environ, "PROJECT_ROOT": str(ROOT)},
            check=False,
        )
        out = proc.stdout if proc.returncode == 0 else f"{proc.stdout}{proc.stderr}"
        return out.rstrip("\n")[: self.max_output_bytes]


class EditTool(HMETool):
    name = "Edit"
    description = "Performs exact string replacement in a file. You must Read the file in this conversation before editing. old_string must match the file exactly and be unique unless replace_all is set."
    inputs = {
        "file_path": {"type": "string", "description": "The absolute path to the file to modify."},
        "old_string": {"type": "string", "description": "The text to replace."},
        "new_string": {"type": "string", "description": "The text to replace it with."},
        "replace_all": {"type": "boolean", "description": "Replace all occurrences (default false).", "nullable": True},
    }
    output_type = "string"
    side_effect = "write"
    approval = "always"
    idempotent = False
    input_aliases = {"file_path": ["file"]}
    passthrough_target = "exec_command"
    bridge_action = "edit"
    host_native = False
    visibility = {"progress_label": "Edit {file_path}", "result_summary": "status"}
    policy = {"requires_prior_read": True, "exact_match": True}

    def forward(self, file_path: str, old_string: str, new_string: str, replace_all: bool | None = None) -> str:
        return _run_node_action("edit", {"file_path": file_path, "old_string": old_string, "new_string": new_string, "replace_all": bool(replace_all)})


class ReadTool(HMETool):
    name = "Read"
    description = "Read a file by absolute path. Supports offset/limit for long text, images, PDFs (use pages for large PDFs), and notebooks. Returns numbered lines. Does not read directories."
    inputs = {
        "file_path": {"type": "string", "description": "The absolute path to the file to read."},
        "offset": {"type": "integer", "description": "Line number to start reading from.", "nullable": True},
        "limit": {"type": "integer", "description": "Number of lines to read.", "nullable": True},
        "pages": {"type": "string", "description": 'Page range for PDFs, e.g. "1-5".', "nullable": True},
    }
    output_type = "string"
    side_effect = "read"
    approval = "never"
    idempotent = True
    visibility = {"progress_label": "Read {file_path}", "result_summary": "bytes"}
    policy = {"context_guard": True, "requires_absolute_path": True}

    def forward(self, file_path: str, offset: int | None = None, limit: int | None = None, pages: str | None = None) -> str:
        payload: dict[str, Any] = {"file_path": file_path}
        if offset is not None:
            payload["offset"] = int(offset)
        if limit is not None:
            payload["limit"] = int(limit)
        if pages:
            payload["pages"] = pages
        return _run_node_action("read", payload)


class WebFetchTool(HMETool):
    name = "WebFetch"
    description = "Fetch and summarize a public URL with a prompt. URL must be valid; redirects require a follow-up request. Avoid private/authenticated URLs; use authenticated MCP or gh for GitHub when available. Read-only, cached briefly, may summarize large pages."
    inputs = {
        "url": {"type": "string", "description": "The URL to fetch content from."},
        "prompt": {"type": "string", "description": "The prompt to run on the fetched content."},
    }
    output_type = "string"
    side_effect = "network"
    approval = "never"
    idempotent = True
    visibility = {"progress_label": "WebFetch {url}", "result_summary": "bytes"}

    def forward(self, url: str, prompt: str) -> str:
        return _run_node_action("web_fetch", {"url": url, "prompt": prompt})


class WebSearchTool(HMETool):
    name = "WebSearch"
    description = "Search the web for current or post-cutoff info. Use 2026 in recent/current queries. Supports allowed/blocked domain filters. If used, final answer must include a Sources section with relevant result links."
    inputs = {
        "query": {"type": "string", "description": "The search query to use."},
        "allowed_domains": {"type": "array", "description": "Only include results from these domains.", "nullable": True},
        "blocked_domains": {"type": "array", "description": "Exclude results from these domains.", "nullable": True},
    }
    output_type = "string"
    side_effect = "network"
    approval = "never"
    idempotent = True
    visibility = {"progress_label": "WebSearch {query}", "result_summary": "sources"}

    def forward(self, query: str, allowed_domains: list[str] | None = None, blocked_domains: list[str] | None = None) -> str:
        del allowed_domains, blocked_domains
        return f"WebSearch execution is provided by the host-native web_search tool for query: {query}"


class WriteTool(HMETool):
    name = "Write"
    description = "Writes a file to the local filesystem, overwriting if one exists. Use for creating a new file or fully replacing one you have already Read. For partial changes, use Edit instead."
    inputs = {
        "file_path": {"type": "string", "description": "The absolute path to the file to write."},
        "content": {"type": "string", "description": "The content to write to the file."},
    }
    output_type = "string"
    side_effect = "write"
    approval = "always"
    idempotent = False
    visibility = {"progress_label": "Write {file_path}", "result_summary": "status"}
    policy = {"requires_prior_read_for_overwrite": True}

    def forward(self, file_path: str, content: str) -> str:
        return _run_node_action("write", {"file_path": file_path, "content": content})


def canonical_tools() -> list[HMETool]:
    return [AgentTool(), BashTool(), EditTool(), ReadTool(), WebFetchTool(), WebSearchTool(), WriteTool()]


def tool_by_name(name: str) -> HMETool:
    for tool in canonical_tools():
        if tool.name == name:
            return tool
    raise KeyError(f"unknown HME tool: {name}")
