"""Check the GitHub Actions setup for the supply-chain rules.

Reads .github/workflows/*.yml and .github/dependabot.yml as text (no YAML library) and fails on:
  - an action that is not pinned to a full commit SHA, or a SHA with no `# vX.Y.Z` comment
  - a workflow with no top-level `permissions:`, or one that grants write at the top level
  - the pull_request_target trigger
  - `npm ci` without --ignore-scripts, any `npm install`, and `npx` without an exact version
  - actions/checkout without `persist-credentials: false`
  - a missing Dependabot config for npm or github-actions

Usage: python scripts/check_workflows.py [repo-root]
Exit status: 0 clean, 1 a check failed, 2 no workflows found.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

USES = re.compile(r"^\s*(?:-\s+)?uses:\s*(\S+)(?:\s+#\s*(.*))?$")
PINNED = re.compile(r"^[\w.-]+/[\w.-]+(?:/[\w./-]+)?@[0-9a-f]{40}$")
VERSION_COMMENT = re.compile(r"^v\d+(\.\d+)*")
NPX_EXACT = re.compile(r"\bnpx\b(?:\s+-{1,2}[\w-]+)*\s+[\w@/.-]+@\d+\.\d+\.\d+")


def indent(line: str) -> int:
    return len(line) - len(line.lstrip())


def top_level_permissions(lines: list[str]) -> list[str] | None:
    """The lines under a column-0 `permissions:` key, or None if there is no such key."""
    for number, line in enumerate(lines):
        if re.match(r"^permissions:", line):
            inline = line.split(":", 1)[1].strip()
            block = [inline] if inline else []
            for after in lines[number + 1 :]:
                if after.strip() and not after.lstrip().startswith("#") and indent(after) == 0:
                    break
                block.append(after)
            return block
    return None


def step_lines(lines: list[str], index: int) -> list[str]:
    """The lines of the step that holds lines[index]: up to the next line at the step's own indent."""
    line = lines[index]
    dash = indent(line) if line.lstrip().startswith("- ") else indent(line) - 2
    block = [line]
    for after in lines[index + 1 :]:
        if after.strip() and indent(after) <= dash:
            break
        block.append(after)
    return block


def check_workflow(name: str, text: str) -> list[str]:
    problems: list[str] = []
    lines = text.splitlines()

    permissions = top_level_permissions(lines)
    if permissions is None:
        problems.append("no top-level permissions: (the default token is too broad); use `permissions: {}`")
    else:
        for line in permissions:
            if re.search(r":\s*write\b|write-all", line):
                problems.append(f"top-level permissions grants write ({line.strip()}); grant it on the job that needs it")

    for number, line in enumerate(lines, 1):
        code = line.split("#", 1)[0]
        if re.search(r"\bpull_request_target\b", code):
            problems.append(f"line {number}: pull_request_target runs with secrets on untrusted code; do not use it")
        if re.search(r"\bnpm\s+(install|i|add)\b", code):
            problems.append(f"line {number}: use npm ci --ignore-scripts, never npm install")
        if re.search(r"\bnpm\s+ci\b", code) and "--ignore-scripts" not in code:
            problems.append(f"line {number}: npm ci needs --ignore-scripts")
        if re.search(r"\bnpx\b", code) and not NPX_EXACT.search(code):
            problems.append(f"line {number}: npx must name a package at an exact version (name@1.2.3)")

        match = USES.match(line)
        if not match:
            continue
        target, comment = match.group(1), (match.group(2) or "").strip()
        if target.startswith("./"):
            continue
        if not PINNED.match(target):
            problems.append(f"line {number}: {target} is not pinned to a full commit SHA")
        elif not VERSION_COMMENT.match(comment):
            problems.append(f"line {number}: {target.split('@')[0]} needs a '# vX.Y.Z' comment after the SHA")
        if target.startswith("actions/checkout@") and not any(re.search(r"persist-credentials:\s*false\b", s) for s in step_lines(lines, number - 1)):
            problems.append(f"line {number}: actions/checkout needs `persist-credentials: false`")
    return problems


def check_dependabot(text: str | None) -> list[str]:
    if text is None:
        return ["dependabot.yml is missing"]
    return [f"dependabot.yml has no {eco} ecosystem" for eco in ("npm", "github-actions") if not re.search(rf"package-ecosystem:\s*[\"']?{eco}[\"']?\s*$", text, re.MULTILINE)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("root", nargs="?", default=".", type=Path, help="repository root (default: .)")
    root = parser.parse_args().root
    workflows = sorted((root / ".github" / "workflows").glob("*.y*ml"))
    if not workflows:
        print(f"error: no workflows in {root / '.github' / 'workflows'}.", file=sys.stderr)
        return 2

    failures: list[tuple[str, str]] = []
    for path in workflows:
        failures.extend((path.name, p) for p in check_workflow(path.name, path.read_text(encoding="utf-8")))
    dependabot = root / ".github" / "dependabot.yml"
    failures.extend(("dependabot.yml", p) for p in check_dependabot(dependabot.read_text(encoding="utf-8") if dependabot.is_file() else None))

    print(f"workflows:  {len(workflows)} file(s)")
    for name, message in failures:
        print(f"FAIL {name}: {message}")
    print(f"workflows checked: {len(failures)} failure(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
