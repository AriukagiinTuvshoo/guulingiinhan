"""Run auth-artifact maintenance; defaults to dry-run unless --apply is supplied."""
import argparse
import json

from app.db import SessionLocal
from app.maintenance import prune_expired_auth_artifacts, prune_expired_trash


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Delete expired authentication artifacts")
    parser.add_argument("--trash-days", type=int, default=30, help="Trash retention days (1–3650)")
    args = parser.parse_args()
    if not 1 <= args.trash_days <= 3650:
        parser.error("--trash-days must be between 1 and 3650")
    with SessionLocal() as db:
        try:
            counts = prune_expired_auth_artifacts(db, apply=args.apply)
            counts["trash_records"] = prune_expired_trash(db, retention_days=args.trash_days, apply=args.apply)
            if args.apply:
                db.commit()
            else:
                db.rollback()
        except Exception:
            db.rollback()
            raise
    print(json.dumps({"applied": args.apply, "counts": counts}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
