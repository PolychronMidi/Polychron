# Symbol Tools

### lookup_symbol(name, kind="", language="")
Find symbol definitions by name (case-insensitive partial match).
- kind: function/class/struct/trait/interface/enum/type/method/impl/const/macro

### search_symbols(query, top_k=20, kind="")
Semantic symbol search. Use when you know the purpose but not the name.

### find_callers(symbol_name, language="")
Find all call sites: `name(`, `.name(`, `::name(`.

### get_file_summary(file_path)
File structure: line count, defined symbols, export preview. Faster than reading whole file.

### get_module_map(directory="", max_depth=3)
Project module tree with file stats and key type names per directory.

### get_function_body(function_name, file_path="", language="")
Return full function body by name. With file_path: search in that file. Without: lookup via symbol index then extract body using tree-sitter AST.
Supports: Rust, TypeScript, JavaScript, Python, C, C++, C#, Go, PHP. Falls back to regex for unsupported languages.
