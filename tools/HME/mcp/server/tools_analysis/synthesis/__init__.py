"""Synthesis subpackage — inference providers and session management."""
# Import ALL subpackage modules so parent sys.modules aliasing works.
# Without these imports, _alias_subpackage has nothing to alias.
from .synthesis import *  # noqa: F401,F403
from .synthesis_config import *  # noqa: F401,F403
from .synthesis_session import *  # noqa: F401,F403

# Ensure every module is in sys.modules for parent aliasing
from . import synthesis_llamacpp  # noqa: F401
from . import synthesis_inference  # noqa: F401
from . import synthesis_cascade  # noqa: F401
from . import synthesis_provider_base  # noqa: F401
from . import synthesis_proxy_route  # noqa: F401
from . import synthesis_reasoning  # noqa: F401
from . import synthesis_pipeline  # noqa: F401
from . import synthesis_warm  # noqa: F401
from . import synthesis_groq  # noqa: F401
from . import synthesis_cerebras  # noqa: F401
from . import synthesis_mistral  # noqa: F401
from . import synthesis_nvidia  # noqa: F401
from . import synthesis_openrouter  # noqa: F401
from . import synthesis_gemini  # noqa: F401
