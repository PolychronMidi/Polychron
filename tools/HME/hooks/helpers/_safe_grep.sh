#!/usr/bin/env bash
set -euo pipefail

ROOT=${PROJECT_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}
MAX_BYTES=${HME_SAFE_GREP_MAX_BYTES:-65536}
MAX_LINE=${HME_SAFE_GREP_MAX_LINE:-2048}

volatile_re='(^|/)(tools/HME/session-state\.json|tools/HME/service/before-editing-cache\.json|tools/HME/runtime/|log/|tmp/|cache/)'

for arg in "$@"; do
  case "$arg" in
    -R|-r|--recursive) recursive=1 ;;
  esac
done

if [[ ${recursive:-0} == 1 ]]; then
  for arg in "$@"; do
    [[ "$arg" == -* ]] && continue
    target="$arg"
    [[ -e "$target" ]] || continue
    while IFS= read -r -d '' file; do
      rel=${file#"$ROOT"/}
      if [[ "$rel" =~ $volatile_re ]]; then
        echo "safe-grep: blocked volatile recursive target: $rel" >&2
        exit 64
      fi
      size=$(wc -c < "$file" 2>/dev/null || echo 0)
      if (( size > MAX_BYTES )); then
        echo "safe-grep: blocked large recursive target: $rel ($size bytes)" >&2
        exit 64
      fi
      if awk -v max="$MAX_LINE" 'length($0)>max{exit 1}' "$file" 2>/dev/null; then :; else
        echo "safe-grep: blocked long-line recursive target: $rel" >&2
        exit 64
      fi
    done < <(find "$target" -type f -print0 2>/dev/null)
  done
fi

exec grep "$@"
