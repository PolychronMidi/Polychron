#!/usr/bin/env python3
"""HME local agentic research — replaces Claude subagents with llama.cpp + RAG + tools.

Read-only agentic loop: llama.cpp reasons over RAG context and can issue
grep/glob/read/kb commands, iterating until the answer is complete.

Advantages over Claude agents:
  - RAG context injected upfront (KB entries, architectural constraints)
  - Session narrative from recent conversation
  - No context window limit (can read as many files as needed)
  - Project-specific knowledge that Claude agents lack

Safety: NO edit, write, bash, or any mutation capability. Read-only research only.

Usage:
  python3 agent_local.py --prompt "where does X happen" [--project /path]
  echo '{"prompt":"..."}' | python3 agent_local.py --stdin
"""
import glob as _glob_mod
import json
import logging
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

# Central .env loader — fail-fast semantics.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hme_env import ENV  # noqa: E402

logger = logging.getLogger("HME.agent_local")

PROJECT_ROOT = ENV.require("PROJECT_ROOT")
_SHIM_PORT = ENV.require_int("HME_SHIM_PORT")

# Model config — llama-server (OpenAI /v1/chat/completions) is the only backend.
_ARBITER_MODEL = ENV.require("HME_ARBITER_MODEL")
_CODER_MODEL = ENV.require("HME_CODER_MODEL")
_REASONER_MODEL = ENV.require("HME_REASONING_MODEL")
_LLAMACPP_ARBITER_URL = ENV.require("HME_LLAMACPP_ARBITER_URL")
_LLAMACPP_CODER_URL   = ENV.require("HME_LLAMACPP_CODER_URL")
# Deprecated port constants — kept only as placeholders for _route_model's
# (model, port, label) tuple shape; not used for actual HTTP dispatch under
# llama-server (which uses base URLs, not ports).
_ARBITER_PORT  = 8080
_CODER_PORT    = 8081
_REASONER_PORT = 8081

_MAX_TOOL_OUTPUT = 8000   # was 3000 — bigger tool outputs for comprehensive audits
_ARBITER_TIMEOUT = 120    # was 30 — CPU 4b model needs more time for JSON planning
_REASONER_TIMEOUT = 240   # was 180 — larger contexts need more generation budget
_TOTAL_TIMEOUT = 420      # was 300 — matches expanded per-stage budgets

# Query type signals for model routing
_CODE_SIGNALS = {"function", "implementation", "code", "how does", "logic",
                 "algorithm", "pattern", "method", "class", "module", "import",
                 "variable", "constant", "return", "parameter", "signature"}
_REASON_SIGNALS = {"why", "design", "architecture", "relationship", "trade-off",
                   "decision", "compare", "difference", "purpose", "motivation",
                   "when should", "pros and cons", "boundary", "constraint"}


