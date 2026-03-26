# Claude Code Setup for Polychron

## Installation & Environment

The `claude` CLI is installed via VS Code extension at `~/.vscode/extensions/anthropic.claude-code-2.1.84-linux-x64/resources/native-binary/claude`. Add to PATH via `~/.bashrc`: `export PATH="$HOME/.local/bin:$PATH"` and symlink the binary.

## Plugins

4 plugins are installed and active:
- `typescript-lsp` - TypeScript language server (LSP support)
- `claude-md-management` - Manages CLAUDE.md via `/claude-md-management:revise-claude-md` skill
- `claude-code-setup` - Recommends Claude Code automations
- `coderabbit` - Runs code review via `/coderabbit:code-review` skill

Use `/coderabbit:code-review` after significant changes. Use `/claude-code-setup:claude-automation-recommender` to identify automation opportunities.

## Critical Architecture Rules

**DO NOT auto-tune or manually override these** - the 16+ hypermeta self-calibrating controllers already own them:
- Coupling targets, pair baselines, coherent relaxation, coherent threshold scale, progressive strength, flicker dampening, axis energy distribution, global gain multiplier
- When an axis is suppressed/dominant, diagnose WHY the controller isn't working instead of adding manual overrides
- Pipeline script `check-hypermeta-jurisdiction.js` enforces this - violations cause failure (legacy ones allowlisted)
- Never read `.couplingMatrix` outside coupling engine/meta-controllers/pipeline plumbing (ESLint `local/no-direct-coupling-matrix-read`)
