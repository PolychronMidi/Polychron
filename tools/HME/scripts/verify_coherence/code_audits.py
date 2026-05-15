"""Code-audit verifiers (split). All Verifier classes now live in
sibling modules -- this file re-exports them so existing
`from .code_audits import X` imports in __init__.py keep working.

  code_audits_style.py    -- code-style/heuristic verifiers
  code_audits_state.py    -- state/lifecycle/integration verifiers
  code_audits_runtime.py  -- runtime/test/syntax verifiers
"""
from .code_audits_style import (  # noqa: F401
    CorePrinciplesAuditVerifier,
    HardcodedToolInvocationVerifier,
    AgentLoopQualityVerifier,
    RepeatedCharSpamVerifier,
    CommentBloatVerifier,
    MarkdownLinkIntegrityVerifier,
)
from .code_audits_antifork import (  # noqa: F401
    AntiForkHeuristicListVerifier,
)
from .code_audits_state import (  # noqa: F401
    StateFileOwnershipVerifier,
    ClaudeSettingsJsonVerifier,
    HumanDeferredAuditVerifier,
    ProxyMiddlewareRegistryVerifier,
    CompatibilityLayerExpiryVerifier,
    ToolMetadataFactoryVerifier,
    GeneratedISurfaceVerifier,
    InterControllerCoherenceVerifier,
    ShellHookAuditVerifier,
    ActivityEventsDocSyncVerifier,
)
from .code_audits_atomic import (  # noqa: F401
    AtomicStateWritesVerifier,
)
from .code_audits_test import (  # noqa: F401
    SilentFailureClassVerifier,
    TestIsolationVerifier,
    TestEnvUndefinedVerifier,
)
from .code_audits_syntax import (  # noqa: F401
    ShellUndefinedVarsVerifier,
    PythonSyntaxVerifier,
    ShellSyntaxVerifier,
    StalePathRenameVerifier,
)
from .code_audits_conjugate import (  # noqa: F401
    ConjugateChannelVerifier,
    _count_legendary_streak,
)
