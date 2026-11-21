"""Prove from a JUnit report that the intended tests actually executed.

pytest exits 0 when every test in a selected file is skipped, so a missing
environment variable could leave a green CI job that asserted nothing. CI writes
``--junitxml`` reports for the PostgreSQL-bound steps and calls this script, which
reads the machine-readable result instead of parsing human-oriented console output.

Parsing uses ``defusedxml`` so a tampered or hostile report (external entities,
billion-laughs payloads) is rejected instead of resolved; malformed or empty
reports fail with a clear message rather than a traceback.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from defusedxml import ElementTree as ET
from defusedxml.common import DefusedXmlException


def inspect_report(report: Path) -> tuple[int, int, int]:
    """Return (executed, skipped, failed) test-case counts from a JUnit XML report."""
    try:
        root = ET.parse(report).getroot()
    except (DefusedXmlException, SyntaxError) as error:
        # ParseError subclasses SyntaxError; DefusedXmlException covers
        # entity/external-reference attacks. Never dump a traceback or the
        # hostile payload into CI logs.
        raise ValueError(f"unreadable or unsafe JUnit report: {error}") from None
    executed = 0
    skipped = 0
    failed = 0
    for case in root.iter("testcase"):
        if case.find("skipped") is not None:
            skipped += 1
            continue
        if case.find("failure") is not None or case.find("error") is not None:
            failed += 1
        executed += 1
    return executed, skipped, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="pytest --junitxml output file")
    parser.add_argument(
        "--min-tests",
        type=int,
        default=1,
        help="minimum number of tests that must have actually executed",
    )
    parser.add_argument(
        "--allow-skips",
        action="store_true",
        help="accept skipped tests (still enforces --min-tests on the executed ones)",
    )
    args = parser.parse_args()

    if not args.report.is_file():
        print(f"FAIL: no JUnit report at {args.report}; pytest never produced a result file", file=sys.stderr)
        return 2
    try:
        executed, skipped, failed = inspect_report(args.report)
    except ValueError as error:
        print(f"FAIL: {error} (report: {args.report})", file=sys.stderr)
        return 2

    problems: list[str] = []
    if failed:
        problems.append(f"{failed} test(s) failed or errored")
    if executed < args.min_tests:
        problems.append(f"only {executed} test(s) executed, at least {args.min_tests} required")
    if skipped and not args.allow_skips:
        problems.append(f"{skipped} test(s) skipped, which is not allowed for this step")
    if problems:
        summary = f"executed={executed} skipped={skipped} failed={failed}"
        print(f"FAIL: {'; '.join(problems)} ({summary}, report: {args.report})", file=sys.stderr)
        return 1
    print(f"OK: executed={executed} skipped={skipped} failed={failed} (report: {args.report})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
