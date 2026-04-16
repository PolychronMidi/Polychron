"""Synthesis subpackage — inference providers and session management."""
# Re-export everything so `from .synthesis import X` and
# `from .synthesis_groq import X` both work via parent sys.modules aliasing.
from .synthesis import *  # noqa: F401,F403
from .synthesis_config import *  # noqa: F401,F403
from .synthesis_session import *  # noqa: F401,F403
