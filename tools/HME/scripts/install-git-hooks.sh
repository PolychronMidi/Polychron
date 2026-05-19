#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
install -m 0755 "$ROOT/tools/HME/git-hooks/pre-commit" "$ROOT/.git/hooks/pre-commit"
echo "installed .git/hooks/pre-commit from tools/HME/git-hooks/pre-commit"
