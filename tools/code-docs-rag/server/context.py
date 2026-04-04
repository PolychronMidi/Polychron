"""Shared server state — engines, model, config, MCP app instance.

Initialized by main.py at startup. Tool modules import from here.
"""
import os
import logging
from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("code-docs-rag")

# Populated by main.py before tool modules load
PROJECT_ROOT: str = ""
PROJECT_DB: str = ""
mcp: FastMCP = None  # type: ignore
project_engine = None  # RAGEngine
global_engine = None   # RAGEngine
shared_model = None    # SentenceTransformer
lib_engines: dict = {}
