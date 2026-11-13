"""Hold Lighthouse reports to the site's budgets.

Reads every *.json report in a folder and fails when a score or a metric is outside its budget,
or when a report holds a run error instead of results. A page can have several runs, written as
<page>.1.json, <page>.2.json and so on: shared CI machines are noisy, so the run with the
median performance score stands for the page, as Lighthouse itself recommends. A run that
errored is ignored when another run of the same page finished.

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


def check_page(paths: list[Path]) -> tuple[list[str], int]:
    """Return what is wrong with one page and how many runs it was judged on.

    Runs that cannot be read or that hold a run error are set aside when at least one run
    finished; if none finished, the first problem found is reported. Of the finished runs, the
    one with the median performance score is the one held to the budgets (the lower middle one
    when the count is even, so the check errs on the strict side).
    """
    finished: list[dict] = []
    first_problems: list[str] = []
    for path in paths:
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            first_problems = first_problems or [f"cannot read the report ({error})"]
            continue
        if report.get("runtimeError"):
            first_problems = first_problems or check_report(report)
            continue
        finished.append(report)
    if not finished:
        return first_problems, len(paths)

    def performance(report: dict) -> float:
        score = report.get("categories", {}).get("performance", {}).get("score")
        return -1.0 if score is None else score

    median = sorted(finished, key=performance)[(len(finished) - 1) // 2]
    return check_report(median), len(finished)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", nargs="?", default="lighthouse", type=Path, help="reports folder (default: lighthouse)")
    folder = parser.parse_args().folder
    reports = sorted(folder.glob("*.json")) if folder.is_dir() else []
    if not reports:
        print(f"error: no Lighthouse reports in {folder}.", file=sys.stderr)
        return 2

    pages: dict[str, list[Path]] = {}
    for path in reports:
        pages.setdefault(path.stem.split(".")[0], []).append(path)

    failed = 0
    for page, paths in pages.items():
        problems, runs = check_page(paths)
        note = f" (median of {runs} runs)" if runs > 1 else ""
        print(f"{'FAIL' if problems else 'ok  '} {page}{note}")
        for problem in problems:
            print(f"     {problem}")
        failed += bool(problems)
    print(f"lighthouse checked: {len(pages)} page(s), {failed} over budget")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
