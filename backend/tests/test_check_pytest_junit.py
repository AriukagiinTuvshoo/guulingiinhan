"""Tests for scripts/check_pytest_junit.py (CI JUnit report gate, defusedxml port)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

from scripts import check_pytest_junit as gate

VALID_JUNIT = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="0" skipped="0" tests="3">
    <testcase classname="tests.test_a" name="test_one" time="0.1"/>
    <testcase classname="tests.test_a" name="test_two" time="0.2"/>
    <testcase classname="tests.test_b" name="test_three" time="0.3"/>
  </testsuite>
</testsuites>
"""

SKIPPED_JUNIT = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" errors="0" failures="1" skipped="1" tests="3">
    <testcase classname="tests.test_a" name="test_one" time="0.1"/>
    <testcase classname="tests.test_a" name="test_skipped" time="0.0">
      <skipped message="not run"/>
    </testcase>
    <testcase classname="tests.test_a" name="test_failed" time="0.1">
      <failure message="boom">assert False</failure>
    </testcase>
  </testsuite>
</testsuites>
"""

XXE_JUNIT = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE testsuite [
  <!ENTITY xxe SYSTEM "file:///etc/passwd">
]>
<testsuite name="pytest">
  <testcase classname="t" name="&xxe;"/>
</testsuite>
"""


def run_gate(monkeypatch: pytest.MonkeyPatch, *argv: str) -> int:
    monkeypatch.setattr(sys, "argv", ["check_pytest_junit.py", *argv])
    return gate.main()


def test_valid_junit_xml_passes(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "ok.xml"
    report.write_text(VALID_JUNIT, encoding="utf-8")
    assert run_gate(monkeypatch, str(report), "--min-tests", "3") == 0
    out = capsys.readouterr()
    assert "OK: executed=3 skipped=0 failed=0" in out.out


def test_malformed_xml_fails_gracefully(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "broken.xml"
    report.write_text("<?xml version='1.0'?><testsuite><testcase", encoding="utf-8")
    assert run_gate(monkeypatch, str(report)) == 2
    err = capsys.readouterr().err
    assert "FAIL: unreadable or unsafe JUnit report" in err
    assert "Traceback" not in err


def test_external_entity_payload_is_rejected(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "xxe.xml"
    report.write_text(XXE_JUNIT, encoding="utf-8")
    assert run_gate(monkeypatch, str(report)) == 2
    err = capsys.readouterr().err
    assert "FAIL: unreadable or unsafe JUnit report" in err
    # The entity must never be resolved: no file contents leak into the log.
    assert "root:" not in err
    assert "Traceback" not in err


def test_unexpected_xml_structure_fails_min_tests(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "wrong.xml"
    report.write_text("<html><body><p>not a junit report</p></body></html>", encoding="utf-8")
    assert run_gate(monkeypatch, str(report), "--min-tests", "1") == 1
    err = capsys.readouterr().err
    assert "only 0 test(s) executed, at least 1 required" in err


def test_missing_file_fails_with_clear_message(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "never-written.xml"
    assert run_gate(monkeypatch, str(report)) == 2
    err = capsys.readouterr().err
    assert "no JUnit report" in err
    assert "Traceback" not in err


def test_empty_file_fails_gracefully(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "empty.xml"
    report.write_text("", encoding="utf-8")
    assert run_gate(monkeypatch, str(report)) == 2
    err = capsys.readouterr().err
    assert "FAIL: unreadable or unsafe JUnit report" in err
    assert "Traceback" not in err


def test_skipped_tests_rejected_unless_allowed(tmp_path: Path, monkeypatch, capsys) -> None:
    report = tmp_path / "skipped.xml"
    report.write_text(SKIPPED_JUNIT, encoding="utf-8")
    assert run_gate(monkeypatch, str(report)) == 1
    assert "skipped, which is not allowed" in capsys.readouterr().err
    assert run_gate(monkeypatch, str(report), "--allow-skips") == 1  # failure still counts
    assert "1 test(s) failed or errored" in capsys.readouterr().err


def test_inspect_report_counts() -> None:
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".xml", encoding="utf-8", delete=False) as fh:
        fh.write(SKIPPED_JUNIT)
        path = Path(fh.name)
    try:
        # test_one executes; test_skipped is skipped (not executed);
        # test_failed both executes and counts as failed.
        assert gate.inspect_report(path) == (2, 1, 1)
    finally:
        path.unlink()
