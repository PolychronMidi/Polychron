"""HME local agentic research — package split R104.

Read-only agentic loop: llama.cpp reasons over RAG context and can issue
grep/glob/read/kb commands, iterating until the answer is complete.

Original 1030-line agent_local.py split into:
  _base.py     env-derived constants + routing signal sets
  models.py    model invocation (_call_model/_arbiter/_synthesizer) + RAG fetch
  tools.py     tool execution (grep/glob/read/kb) + call parsing
  research.py  stop-word learning + pre-research + run_agent orchestrator
  __main__.py  entry point for `python3 -m agent_local` / script invocation

Advantages over Claude subagents:
  - RAG context injected upfront (KB entries, architectural constraints)
  - Session narrative from recent conversation
  - No context window limit (can read as many files as needed)
  - Project-specific knowledge that Claude agents lack

Safety: NO edit/write/bash — strictly read-only research.
"""
from __future__ import annotations

from .research import run_agent  # noqa: F401
