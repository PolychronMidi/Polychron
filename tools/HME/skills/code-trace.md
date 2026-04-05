# Code Trace

### get_dependency_graph(file_path)
Import graph: what a file imports and what imports it.

### type_hierarchy(type_name="")
Class/struct/trait/interface inheritance tree. ""=full hierarchy.

### cross_language_trace(symbol_name)
Trace Rust-WASM bridge-TS call chain. Auto-detects snake_case/camelCase.

### bulk_rename_preview(old_name, new_name, language="")
Preview rename impact. Groups: definition/call/import/type_reference/string_literal/comment.
