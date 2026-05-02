# HME server package
# audit: flat-package
#
# server/ is architecturally a flat runtime namespace, not a strict
# subsystem with a tight public API. Sibling-to-sibling imports
# (`from server.tool_registry import names`, `from server import context`,
# etc.) are normal and intentional — there is no public/private split
# between submodules. The flat-package marker tells audit-import-boundaries
# to skip strict-surface checks for this directory, while leaving the
# strict checks intact for genuinely-bounded subsystems below
# (tools_analysis/, synthesis/, evolution/, etc.).
