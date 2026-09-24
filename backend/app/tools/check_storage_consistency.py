"""CLI entry point for a read-only photo storage consistency report."""

from __future__ import annotations

import argparse
import json

from app.db import SessionLocal
from app.storage import get_storage
from app.tools.storage_consistency import check_storage_consistency


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check PostgreSQL photo metadata against private object storage. Read-only."
    )
    parser.add_argument("--prefix", default="families/", help="Storage prefix to inspect.")
    args = parser.parse_args()

    with SessionLocal() as db:
        report = check_storage_consistency(db, get_storage(), prefix=args.prefix)
    print(json.dumps(report.as_dict(), ensure_ascii=False, indent=2))
    return 0 if report.ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
