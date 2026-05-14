#!/usr/bin/env python3
"""Project stack auto-detection. Adapted from Pad's internal/cli/detect.go.

Scans repo root for build manifests (go.mod / package.json / Cargo.toml /
pyproject.toml / Gemfile / pom.xml / Makefile / etc). Emits a stable JSON
shape naming detected language(s), test runner, build command. Output goes
to UserPromptSubmit additionalContext so subagents (especially the tester
specialist) know to use `pytest` vs `npm test` vs `cargo test` without
inferring per-call.

Usage:
  i/status project            # human-readable
  i/status project --json     # machine output
  i/status project --tag      # one-line additionalContext tag for hooks
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_PROJECT = Path(os.environ.get("PROJECT_ROOT") or
                Path(__file__).resolve().parents[3])

# Manifest -> (language, default test cmd, default build cmd) mapping.
_MANIFESTS = (
    ("go.mod",          "go",         "go test ./...",                 "go build ./..."),
    ("package.json",    "javascript", "npm test",                      "npm run build"),
    ("Cargo.toml",      "rust",       "cargo test",                    "cargo build"),
    ("pyproject.toml",  "python",     "python3 -m pytest",             "python3 -m build"),
    ("setup.py",        "python",     "python3 -m pytest",             "python3 setup.py build"),
    ("Gemfile",         "ruby",       "bundle exec rake test",         "bundle install"),
    ("pom.xml",         "java",       "mvn test",                      "mvn package"),
    ("build.gradle",    "java",       "gradle test",                   "gradle build"),
    ("composer.json",   "php",        "phpunit",                       "composer install"),
    ("mix.exs",         "elixir",     "mix test",                      "mix compile"),
    ("Cargo.toml",      "rust",       "cargo test",                    "cargo build"),
)


def detect(root: Path) -> dict:
    """Walk root for build manifests; return aggregated detection."""
    found: list[dict] = []
    for manifest, lang, test_cmd, build_cmd in _MANIFESTS:
        if (root / manifest).is_file():
            found.append({
                "manifest": manifest,
                "language": lang,
                "test_cmd": test_cmd,
                "build_cmd": build_cmd,
            })
    has_makefile = (root / "Makefile").is_file()
    has_dockerfile = (root / "Dockerfile").is_file()
    has_ci = any((root / p).is_dir() for p in (".github/workflows", ".gitlab-ci"))
    primary = found[0] if found else None
    languages = sorted({f["language"] for f in found})
    return {
        "primary_language": (primary or {}).get("language", "unknown"),
        "all_languages": languages,
        "test_cmd": (primary or {}).get("test_cmd", ""),
        "build_cmd": (primary or {}).get("build_cmd", ""),
        "has_makefile": has_makefile,
        "has_dockerfile": has_dockerfile,
        "has_ci": has_ci,
        "manifests": found,
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=str(_PROJECT))
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--tag", action="store_true",
                        help="one-line additionalContext tag")
    args = parser.parse_args(argv)
    info = detect(Path(args.root))
    if args.tag:
        langs = ",".join(info["all_languages"]) or "unknown"
        bits = [f"lang={langs}", f"test={info['test_cmd'] or 'none'}"]
        if info["has_makefile"]:
            bits.append("makefile")
        if info["has_dockerfile"]:
            bits.append("docker")
        if info["has_ci"]:
            bits.append("ci")
        print(f"[project-detect] {' | '.join(bits)}")
        return 0
    if args.json:
        print(json.dumps(info, indent=2))
        return 0
    print(f"project-detect: primary={info['primary_language']}")
    print(f"  all languages: {', '.join(info['all_languages']) or 'none'}")
    print(f"  test cmd:      {info['test_cmd'] or 'none'}")
    print(f"  build cmd:     {info['build_cmd'] or 'none'}")
    print(f"  Makefile:      {'yes' if info['has_makefile'] else 'no'}")
    print(f"  Dockerfile:    {'yes' if info['has_dockerfile'] else 'no'}")
    print(f"  CI:            {'yes' if info['has_ci'] else 'no'}")
    if info["manifests"]:
        print("  manifests:")
        for m in info["manifests"]:
            print(f"    - {m['manifest']} ({m['language']})")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
