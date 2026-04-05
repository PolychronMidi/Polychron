# Knowledge Management

## Tools

### add_knowledge(title, content, category="general", tags="", scope="project")
- category: bugfix/decision/pattern/operation/architecture
- tags: comma-separated
- scope: "project"/"global"/"both"

### search_knowledge(query, top_k=5, category="")
Semantic search across project+global KB.

### remove_knowledge(entry_id, scope="project")
Delete by ID.

### list_knowledge(category="", scope="")
List all entries. Filter by category/scope.

### compact_knowledge(scope="project", threshold=0.85)
Deduplicate entries above cosine similarity threshold.

### export_knowledge(scope="project", category="")
Export KB as markdown text.

### knowledge_graph(query, max_hops=2)
Search KB with spreading activation. Shows connections between entries + Claude cluster analysis.

### memory_dream()
Pairwise similarity pass across all KB entries. Discovers hidden connections between distant entries.

### kb_health()
Check KB for stale file references, aged entries, dead pointers. Returns actionable cleanup list.
