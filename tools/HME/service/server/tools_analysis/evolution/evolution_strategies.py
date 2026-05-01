"""Evolution strategies — curate, contradict, adversarial stress.

Split from evolution_evolve.py. These are the heavy analysis functions
that each focus on a different evolution mode.
"""
import os
import re
import json
import logging

from server import context as ctx
from .. import _track, _budget_gate, BUDGET_COMPOUND, BUDGET_TOOL

logger = logging.getLogger("HME")



# Re-exports — strategies split into focused siblings.
from .evolution_curate import _auto_curate  # noqa: F401, E402
from .evolution_contradict import _detect_contradictions  # noqa: F401, E402
from .evolution_stress import _adversarial_stress  # noqa: F401, E402
