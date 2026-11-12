"""Hold Lighthouse reports to the site's budgets.

Reads every *.json report in a folder (the CI job writes one per page) and fails when a score
or a metric is outside its budget, or when a report holds a run error instead of results.

Usage: python scripts/check_lighthouse.py [reports-folder]
Exit status: 0 within budget, 1 over budget, 2 no reports found.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Category -> lowest score allowed (0 to 1). Accessibility and SEO are deterministic, so they
# must be perfect. Performance varies with the machine, so it has some room.
MIN_SCORES = {
    "performance": 0.90,
    "accessibility": 1.0,
    "best-practices": 0.95,
    "seo": 1.0,
}

# Audit -> highest value allowed, with the unit to print.
MAX_METRICS = {
    "largest-contentful-paint": (2_500, "ms"),
    "total-blocking-time": (400, "ms"),
    "cumulative-layout-shift": (0.1, ""),
}


def check_report(report: dict) -> list[str]:
    """Return what is wrong with one parsed Lighthouse report."""
    if report.get("runtimeError"):
        code = report["runtimeError"].get("code", "unknown")
        return [f"Lighthouse did not finish ({code})"]
    problems: list[str] = []
    categories = report.get("categories", {})
    for name, floor in MIN_SCORES.items():
        score = categories.get(name, {}).get("score")
        if score is None:
            problems.append(f"{name}: no score in the report")
        elif score < floor:
            problems.append(f"{name} is {score * 100:.0f}, budget is {floor * 100:.0f}")
    audits = report.get("audits", {})
    for name, (ceiling, unit) in MAX_METRICS.items():
        value = audits.get(name, {}).get("numericValue")
        if value is None:
            problems.append(f"{name}: no value in the report")
        elif value > ceiling:
            shown = f"{value:.0f}" if unit else f"{value:.3f}"
            problems.append(f"{name} is {shown}{unit}, budget is {ceiling}{unit}")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", nargs="?", default="lighthouse", type=Path, help="reports folder (default: lighthouse)")
    folder = parser.parse_args().folder
    reports = sorted(folder.glob("*.json")) if folder.is_dir() else []
    if not reports:
        print(f"error: no Lighthouse reports in {folder}.", file=sys.stderr)
        return 2

    failed = 0
    for path in reports:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            problems = [f"cannot read the report ({error})"]
        else:
            problems = check_report(report)
        print(f"{'FAIL' if problems else 'ok  '} {path.stem}")
        for problem in problems:
            print(f"     {problem}")
        failed += bool(problems)
    print(f"lighthouse checked: {len(reports)} page(s), {failed} over budget")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
