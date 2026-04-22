# mcp/server

FastMCP server layer + context. `main.py` boots the MCP server and initializes `ctx.project_engine` / `ctx.global_engine`. `context.py` is the shared state module — any module needing engine refs reads `ctx.project_engine` etc. rather than threading parameters.

`tools_analysis/` holds the public agent-facing tools (evolve, review, learn, trace, hme_admin, etc.); `tools_knowledge.py`, `tools_search.py`, `tools_index.py` hold internal low-level helpers those public tools dispatch to. `onboarding_chain.py` gates tool calls during the 7-step onboarding state machine.

Every tool exposed to agents should be decorated with `@ctx.mcp.tool()` (agent-callable) or `@ctx.mcp.tool(meta={"hidden": True})` (internally-called but routable). Missing the decorator means the tool is invisible to the MCP layer — several subtle bugs have traced back to decorator omission on new modes.

<!-- HME-DIR-INTENT
rules:
  - Shared engine refs live on ctx.project_engine / ctx.global_engine — never pass engines as parameters; consumers read from context directly
  - Every public tool needs @ctx.mcp.tool() decoration; missing decorators silently make new modes unreachable from the agent surface
-->
