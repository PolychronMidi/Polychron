from __future__ import annotations

LANGUAGES: dict[str, dict] = {
    "rust": {
        "extensions": {".rs"},
        "tree_sitter": "rust",
        "func_nodes": {"function_item", "impl_item", "trait_item", "struct_item", "enum_item"},
        "top_containers": {"impl_item", "trait_item"},
        "block_style": "brace",
    },
    "typescript": {
        "extensions": {".ts", ".tsx"},
        "tree_sitter": "typescript",
        "func_nodes": {
            "function_declaration", "method_definition", "class_declaration",
            "interface_declaration", "type_alias_declaration", "enum_declaration",
        },
        "top_containers": {"class_declaration", "interface_declaration"},
        "block_style": "brace",
    },
    "javascript": {
        "extensions": {".js", ".jsx"},
        "tree_sitter": "javascript",
        "func_nodes": {"function_declaration", "method_definition", "class_declaration"},
        "top_containers": {"class_declaration"},
        "block_style": "brace",
    },
    "vue": {
        "extensions": {".vue"},
        "tree_sitter": "javascript",
        "func_nodes": {"function_declaration", "method_definition", "class_declaration"},
        "top_containers": {"class_declaration"},
        "block_style": "brace",
    },
    "python": {
        "extensions": {".py"},
        "tree_sitter": "python",
        "func_nodes": {"function_definition", "class_definition"},
        "top_containers": {"class_definition"},
        "block_style": "indent",
    },
    "c": {
        "extensions": {".c", ".h"},
        "tree_sitter": "c",
        "func_nodes": {"function_definition", "struct_specifier", "enum_specifier"},
        "top_containers": set(),
        "block_style": "brace",
    },
    "cpp": {
        "extensions": {".cpp", ".hpp", ".cc", ".cxx", ".hxx"},
        "tree_sitter": "cpp",
        "func_nodes": {
            "function_definition", "class_specifier", "struct_specifier",
            "enum_specifier", "namespace_definition",
        },
        "top_containers": {"class_specifier", "struct_specifier", "namespace_definition"},
        "block_style": "brace",
    },
    "csharp": {
        "extensions": {".cs"},
        "tree_sitter": "c_sharp",
        "func_nodes": {
            "method_declaration", "class_declaration", "struct_declaration",
            "interface_declaration", "enum_declaration", "namespace_declaration",
        },
        "top_containers": {"class_declaration", "struct_declaration", "namespace_declaration", "interface_declaration"},
        "block_style": "brace",
    },
    "go": {
        "extensions": {".go"},
        "tree_sitter": "go",
        "func_nodes": {"function_declaration", "method_declaration", "type_declaration"},
        "top_containers": set(),
        "block_style": "brace",
    },
    "php": {
        "extensions": {".php"},
        "tree_sitter": "php",
        "func_nodes": {
            "function_definition", "method_declaration", "class_declaration",
            "interface_declaration", "trait_declaration",
        },
        "top_containers": {"class_declaration", "interface_declaration", "trait_declaration"},
        "block_style": "brace",
    },
    "java": {
        "extensions": {".java"},
        "tree_sitter": "java",
        "func_nodes": {
            "method_declaration", "class_declaration", "interface_declaration",
            "enum_declaration", "constructor_declaration",
        },
        "top_containers": {"class_declaration", "interface_declaration", "enum_declaration"},
        "block_style": "brace",
    },
    "kotlin": {
        "extensions": {".kt", ".kts"},
        "tree_sitter": "kotlin",
        "func_nodes": {"function_declaration", "class_declaration", "object_declaration", "companion_object"},
        "top_containers": {"class_declaration", "object_declaration"},
        "block_style": "brace",
    },
    "scala": {
        "extensions": {".scala"},
        "tree_sitter": "scala",
        "func_nodes": {
            "function_definition", "function_declaration", "class_definition",
            "object_definition", "trait_definition",
        },
        "top_containers": {"class_definition", "object_definition", "trait_definition"},
        "block_style": "brace",
    },
    "ruby": {
        "extensions": {".rb"},
        "tree_sitter": "ruby",
        "func_nodes": {"method", "singleton_method", "class", "module"},
        "top_containers": {"class", "module"},
        "block_style": "end_keyword",
    },
    "lua": {
        "extensions": {".lua"},
        "tree_sitter": "lua",
        "func_nodes": {"function_definition_statement", "local_function_definition_statement", "function_declaration"},
        "top_containers": set(),
        "block_style": "end_keyword",
    },
    "elixir": {
        "extensions": {".ex", ".exs"},
        "tree_sitter": "elixir",
        "func_nodes": {"call"},
        "top_containers": set(),
        "block_style": "end_keyword",
    },
    "haskell": {
        "extensions": {".hs"},
        "tree_sitter": "haskell",
        "func_nodes": {"function", "signature", "adt", "type_class"},
        "top_containers": set(),
        "block_style": "indent",
    },
    "r": {
        "extensions": {".r", ".R"},
        "tree_sitter": "r",
        "func_nodes": {"left_assignment", "equals_assignment"},
        "top_containers": set(),
        "block_style": "brace",
    },
    "julia": {
        "extensions": {".jl"},
        "tree_sitter": "julia",
        "func_nodes": {"function_definition", "struct_definition", "module_definition", "abstract_definition"},
        "top_containers": {"module_definition"},
        "block_style": "end_keyword",
    },
    "perl": {
        "extensions": {".pl", ".pm"},
        "tree_sitter": "perl",
        "func_nodes": {"function_definition", "package_statement"},
        "top_containers": set(),
        "block_style": "brace",
    },
    "bash": {
        "extensions": {".sh", ".bash"},
        "tree_sitter": "bash",
        "func_nodes": {"function_definition"},
        "top_containers": set(),
        "block_style": "brace",
    },
    "sql": {
        "extensions": {".sql"},
        "tree_sitter": "sql",
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "makefile": {
        "extensions": {".mk"},
        "filenames": {"Makefile", "GNUmakefile", "makefile"},
        "tree_sitter": "make",
        "func_nodes": {"rule"},
        "top_containers": set(),
        "block_style": None,
    },
    "dockerfile": {
        "extensions": set(),
        "filenames": {"Dockerfile"},
        "tree_sitter": "dockerfile",
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "ocaml": {
        "extensions": {".ml", ".mli"},
        "tree_sitter": "ocaml",
        "func_nodes": {"value_definition", "type_definition", "module_definition"},
        "top_containers": {"module_definition"},
        "block_style": None,
    },
    "erlang": {
        "extensions": {".erl", ".hrl"},
        "tree_sitter": "erlang",
        "func_nodes": {"fun_decl", "module_attribute"},
        "top_containers": set(),
        "block_style": None,
    },
    "objective_c": {
        "extensions": {".m", ".mm"},
        "tree_sitter": "objc",
        "func_nodes": {"method_definition", "class_interface", "class_implementation", "function_definition"},
        "top_containers": {"class_interface", "class_implementation"},
        "block_style": "brace",
    },
    "swift": {
        "extensions": {".swift"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "dart": {
        "extensions": {".dart"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "zig": {
        "extensions": {".zig"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "nim": {
        "extensions": {".nim"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "indent",
    },
    "proto": {
        "extensions": {".proto"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "glsl": {
        "extensions": {".glsl", ".vert", ".frag", ".comp", ".geom", ".tesc", ".tese"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "wgsl": {
        "extensions": {".wgsl"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "hlsl": {
        "extensions": {".hlsl"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": "brace",
    },
    "asm": {
        "extensions": {".s", ".S", ".asm"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "toml": {
        "extensions": {".toml"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "json": {
        "extensions": {".json"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "yaml": {
        "extensions": {".yaml", ".yml"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "markdown": {
        "extensions": {".md"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "html": {
        "extensions": {".html"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "css": {
        "extensions": {".css"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
    "scss": {
        "extensions": {".scss"},
        "tree_sitter": None,
        "func_nodes": set(),
        "top_containers": set(),
        "block_style": None,
    },
}


def _build_lookups():
    ext_map: dict[str, str] = {}
    all_exts: set[str] = set()
    all_filenames: set[str] = set()
    ts_map: dict[str, str] = {}
    func_map: dict[str, set] = {}
    top_map: set[str] = set()

    for lang_name, info in LANGUAGES.items():
        for ext in info["extensions"]:
            ext_map[ext] = lang_name
            all_exts.add(ext)
        for fn in info.get("filenames", set()):
            ext_map[fn] = lang_name
            all_filenames.add(fn)
        ts_name = info.get("tree_sitter")
        if ts_name:
            ts_map[lang_name] = ts_name
            if info["func_nodes"]:
                func_map[ts_name] = info["func_nodes"]
        top_map.update(info.get("top_containers", set()))

    return ext_map, all_exts, all_filenames, ts_map, func_map, top_map


EXT_TO_LANG, SUPPORTED_EXTENSIONS, SUPPORTED_FILENAMES, TS_LANG_MAP, FUNC_NODE_TYPES, TOP_LEVEL_CONTAINERS = _build_lookups()


def ext_to_lang(ext_or_filename: str) -> str:
    return EXT_TO_LANG.get(ext_or_filename, "text")

