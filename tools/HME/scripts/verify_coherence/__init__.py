"""HME unified self-coherence engine (package split R99).

Treats HME's self-coherence as a multi-dimensional signal space: each
`Verifier` produces a 0-1 score, aggregated to the HME Coherence Index
(HCI) on a 0-100 scale. One command, machine-readable output, diffable
across sessions.

Package layout (was single 2842-line verify-coherence.py):
  _base.py              VerdictResult, Verifier, _result, _run_subprocess
  docs.py               doc drift, numeric claims, docstring presence
  env_settings.py       settings.json, env tamper/load, OAuth expiry
  logs.py               log size, error log, lifesaver rate
  plugin_cache.py       plugin cache parity, hook command existence
  hook_layout.py        registration, matcher validity, executability, order
  code_audits.py        core principles, shell hooks, proxy middleware, syntax
  autocommit_health.py  autocommit health, shim health
  onboarding.py         flow, state integrity, chain import, state sync
  todo_tools.py         todo store/merge, tool surface coverage
  meta_observers.py     meta-observer, verifier-coverage, memetic, predictive
  subagent.py           subagent mode/passthrough/guard/backends
  runtime_behavior.py   transient/context/warm/plan
  runtime_perf.py       hook latency, tool-response latency, git coverage
  runtime_safety.py     lifesaver integrity, trajectory trend
  graph.py              feedback graph, reloadable module sync
  __main__.py           run_engine + format_text + main + shim entrypoint

Verifier registration: REGISTRY below (preserves the original ordering).
Adding a verifier = add the class to an existing category module (or new),
import here, append to REGISTRY.
"""
from __future__ import annotations

# Re-export base types so callers can still `from verify_coherence import Verifier`
from ._base import (  # noqa: F401
    Verifier, VerdictResult, _result, _run_subprocess,
    PASS, WARN, FAIL, SKIP, ERROR,
    _PROJECT, _HOOKS_DIR, _SERVER_DIR, _SCRIPTS_DIR, _DOC_DIRS, METRICS_DIR,
)

from .docs import (  # noqa: F401
    DocDriftVerifier, NumericClaimDriftVerifier, DocstringPresenceVerifier,
)
from .env_settings import (  # noqa: F401
    SettingsJsonVerifier, OAuthTokenExpiryVerifier,
    EnvTamperVerifier, EnvLoadVerifier,
)
from .logs import (  # noqa: F401
    LogSizeVerifier, ErrorLogVerifier, LifesaverRateVerifier,
)
from .plugin_cache import (  # noqa: F401
    PluginCacheParityVerifier, HookCommandExistenceVerifier,
)
from .hook_layout import (  # noqa: F401
    HookExecutabilityVerifier, DecoratorOrderVerifier,
    HookRegistrationVerifier, HookMatcherValidityVerifier,
)
from .code_audits import (  # noqa: F401
    CorePrinciplesAuditVerifier, ProxyMiddlewareRegistryVerifier,
    ShellHookAuditVerifier, ShellUndefinedVarsVerifier,
    ClaudeSettingsJsonVerifier, InterControllerCoherenceVerifier,
    PythonSyntaxVerifier, ShellSyntaxVerifier,
    SilentFailureClassVerifier, StateFileOwnershipVerifier,
)
from .autocommit_health import (  # noqa: F401
    AutocommitHealthVerifier, ShimHealthVerifier,
)
from .onboarding import (  # noqa: F401
    StatesSyncVerifier, OnboardingFlowVerifier,
    OnboardingStateIntegrityVerifier, OnboardingChainImportVerifier,
)
from .todo_tools import (  # noqa: F401
    TodoStoreSchemaVerifier, ToolSurfaceCoverageVerifier,
    TodoMergeHookConsistencyVerifier,
)
from .meta_observers import (  # noqa: F401
    MetaObserverCoherenceVerifier, VerifierCoverageGapVerifier,
    MemeticDriftVerifier, PredictiveHCIVerifier,
)
from .subagent import (  # noqa: F401
    SubagentModeVerifier, SubagentPassthroughVerifier,
    SubagentGuardVerifier, SubagentBackendsVerifier,
)
from .runtime_behavior import (  # noqa: F401
    TransientErrorFilterVerifier, ContextBudgetVerifier,
    WarmContextFreshnessVerifier, PlanOutputValidityVerifier,
)
from .runtime_perf import (  # noqa: F401
    HookLatencyVerifier, GitCommitTestCoverageVerifier, ToolResponseLatencyVerifier,
)
from .runtime_safety import (  # noqa: F401
    LifesaverIntegrityVerifier, TrajectoryTrendVerifier,
)
from .graph import (  # noqa: F401
    FeedbackGraphVerifier, ReloadableModuleSyncVerifier,
)

# Preserves the ordering from the original verify-coherence.py — a few
# downstream consumers (dashboard, diff scripts) expect this sequence.
REGISTRY = [
    DocDriftVerifier(),
    NumericClaimDriftVerifier(),
    AutocommitHealthVerifier(),
    EnvLoadVerifier(),
    EnvTamperVerifier(),
    OAuthTokenExpiryVerifier(),
    SettingsJsonVerifier(),
    LogSizeVerifier(),
    PluginCacheParityVerifier(),
    HookCommandExistenceVerifier(),
    CorePrinciplesAuditVerifier(),
    ShellHookAuditVerifier(),
    ShellUndefinedVarsVerifier(),
    SilentFailureClassVerifier(),
    StateFileOwnershipVerifier(),
    ClaudeSettingsJsonVerifier(),
    InterControllerCoherenceVerifier(),
    ProxyMiddlewareRegistryVerifier(),
    DocstringPresenceVerifier(),
    PythonSyntaxVerifier(),
    ShellSyntaxVerifier(),
    HookExecutabilityVerifier(),
    DecoratorOrderVerifier(),
    TodoMergeHookConsistencyVerifier(),
    StatesSyncVerifier(),
    OnboardingFlowVerifier(),
    OnboardingStateIntegrityVerifier(),
    OnboardingChainImportVerifier(),
    TodoStoreSchemaVerifier(),
    ReloadableModuleSyncVerifier(),
    HookRegistrationVerifier(),
    HookMatcherValidityVerifier(),
    ToolSurfaceCoverageVerifier(),
    ShimHealthVerifier(),
    ErrorLogVerifier(),
    SubagentModeVerifier(),
    SubagentPassthroughVerifier(),
    SubagentGuardVerifier(),
    SubagentBackendsVerifier(),
    WarmContextFreshnessVerifier(),
    HookLatencyVerifier(),
    PlanOutputValidityVerifier(),
    GitCommitTestCoverageVerifier(),
    TransientErrorFilterVerifier(),
    VerifierCoverageGapVerifier(),
    MemeticDriftVerifier(),
    ContextBudgetVerifier(),
    PredictiveHCIVerifier(),
    LifesaverIntegrityVerifier(),
    LifesaverRateVerifier(),
    MetaObserverCoherenceVerifier(),
    ToolResponseLatencyVerifier(),
    TrajectoryTrendVerifier(),
    FeedbackGraphVerifier(),
]
