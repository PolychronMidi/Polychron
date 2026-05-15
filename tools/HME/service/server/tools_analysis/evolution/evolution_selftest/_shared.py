"""HME self-test and hot-reload -- tool registration, doc sync, index integrity, llama.cpp health."""
import os
import logging
import sys
import importlib

# Path up four levels to reach tools/HME/service/ (post-split the file sits
# at mcp/server/tools_analysis/evolution/evolution_selftest/_shared.py).
_mcp_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _mcp_root not in sys.path:
    sys.path.insert(0, _mcp_root)
from hme_env import ENV  # noqa: E402

from server import context as ctx
from ...synthesis import _local_think
from ... import _track

logger = logging.getLogger("HME")

from .reload_registry import (  # noqa: E402,F401
    RELOADABLE, SERVER_RELOADABLE, TOP_LEVEL_RELOADABLE,
    ROOT_FIRST_RELOADABLE, ROOT_RELOADABLE, SUBPACKAGES,
    all_reload_targets, module_candidates, candidate_files,
)
