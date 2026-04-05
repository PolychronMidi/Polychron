# Search & Index

### index_codebase(directory="")
Index source files for semantic search. ""=project root. Incremental.

### search_code(query, top_k=10, language="")
Semantic code search. Prefer over Glob/Grep for open-ended queries.
- query: natural language
- language: "rust"/"typescript"/etc

### get_index_status()
Returns indexed file/chunk counts.

### clear_index()
Wipe code index. Run index_codebase after.

### list_libs()
List configured external libraries (from ragLibs in .mcp.json) with index status.

### index_symbols()
Rebuild symbol index. Auto-runs with index_codebase.

### find_similar_code(code_snippet, top_k=10)
Find structurally similar code via semantic similarity.
