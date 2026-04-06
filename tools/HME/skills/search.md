# Search & Index

### hme_admin(action='index')
Reindex all code chunks + symbols. Run after batch changes when file watcher hasn't caught up.

### search_code(query, top_k=10, language="")
Semantic code search. Prefer over Glob/Grep for open-ended queries.
- query: natural language
- language: "rust"/"typescript"/etc

### get_index_status()
Returns indexed file/chunk counts.

### clear_index()
Wipe code index. Run hme_admin(action='index') after.

### list_libs()
List configured external libraries (from ragLibs in .mcp.json) with index status.

### reindex(what="both")
Rebuild indexes. what='codebase': code chunks. what='symbols': symbol index. what='both' (default): runs both.

### find_similar_code(code_snippet, top_k=10)
Find structurally similar code via semantic similarity.
