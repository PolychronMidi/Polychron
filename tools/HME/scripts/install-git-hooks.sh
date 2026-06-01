#!/usr/bin/env bash
set -euo pipefail
ROOT="$(git rev-parse --show-toplevel)"
install -m 0755 "$ROOT/tools/HME/git-hooks/pre-commit" "$ROOT/.git/hooks/pre-commit"
install -m 0755 "$ROOT/tools/HME/git-hooks/post-commit" "$ROOT/.git/hooks/post-commit"
echo "installed .git/hooks/pre-commit and post-commit from tools/HME/git-hooks"
