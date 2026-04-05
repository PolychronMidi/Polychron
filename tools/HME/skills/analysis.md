# Architectural Analysis

### before_editing(file_path)
**START HERE.** One call assembles: KB constraints, callers, boundary warnings, file structure.

### what_did_i_forget(file_paths)
Post-change audit. Comma-separated paths. Checks KB constraints, boundary rules, L0 channels, doc needs.

### module_story(module_name)
Living biography: definition, evolution history, callers, neighbors, KB context.

### diagnose_error(error_text)
Paste error text. Returns: source trace, similar KB bugs, fix patterns.

### codebase_health()
Full-repo convention sweep. Prioritized by severity (CRITICAL/WARN).

### think(topic="")
Structured reflection. Topics: task_adherence, completeness, constraints, impact, conventions, recent_changes.

### blast_radius(symbol_name, max_depth=3)
Transitive dependency chain at depth 1-3. Shows which callers break if symbol changes.

### impact_analysis(symbol_name)
Callers + references + KB constraints in one shot.

### convention_check(file_path)
Audit file against project conventions. Flags violations.

### find_anti_pattern(wrong, right="", path="")
Find boundary violations. Example: `find_anti_pattern wrong="systemDynamicsProfiler" right="conductorSignalBridge" path="src/crossLayer"`

### symbol_audit(mode="both", path="src", top_n=20)
mode='dead': IIFE globals with 0 callers and no self-registration. mode='importance': rank by caller count (architectural centrality). mode='both' (default).

### doc_sync_check(doc_path)
Verify doc matches implementation: tool counts, file refs, section completeness.

### evolution_patterns()
Meta-patterns across evolution journal: confirm/refute rates, subsystem receptivity, recurring themes, stabilization timelines. Uses Claude synthesis for deep pattern interpretation.

### causal_trace(start, max_depth=3)
Trace causal chain from constant/module/signal through controllers, metrics, regime behavior to musical effect. Shows: A -> B -> C -> [what the listener hears].

### hme_inspect(mode="both")
mode='introspect': session tool usage, mandatory tool coverage gaps, last run's musical context, KB/index health. mode='selftest': 8-point health check (tool count, doc sync, index, hash cache, Ollama, KB, symlinks). mode='both' (default).
