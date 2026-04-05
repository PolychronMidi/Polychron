#!/usr/bin/env bash
# HME PreToolUse: Grep — prefer HME grep() for KB enrichment
cat > /dev/null  # consume stdin
echo 'PREFER: Use HyperMeta-Ecstasy grep(pattern, path, file_type, regex=True, context=N, files_only=True) for KB cross-referencing. Built-in Grep allowed for multiline patterns only.' >&2
exit 0
