"""Seed disposable Playwright SQLite database only; never use against real data."""
import os
import re
from datetime import UTC, datetime
from pathlib import Path

url = os.environ.get("DATABASE_URL", "")
if os.environ.get("APP_ENV") != "test" or not re.fullmatch(
    r"sqlite:////tmp/guulingiinhan-e2e-[a-zA-Z0-9_-]+\.sqlite", url
):
    raise SystemExit("Refusing non-disposable test database")
path = Path(url.removeprefix("sqlite:///"))
if not path.is_file() or path.is_symlink():
    raise SystemExit("Migrate a fresh disposable SQLite file first")

from sqlalchemy import select

from app.auth import _password_hash
from app.db import SessionLocal
from app.models import Family, FamilyMember, LoginIdentity, User

with SessionLocal() as db:
    if db.scalar(select(User.id).where(User.email == "e2e-admin-owner@example.com")):
        raise SystemExit("E2E fixtures already present; use a fresh database")
    now = datetime.now(UTC)
    users = []
    for label in ("owner", "delegate"):
        email = f"e2e-admin-{label}@example.com"
        user = User(email=email, display_name=f"E2E {label}", password_hash=_password_hash("e2e-test-password-123"), email_verified_at=now)
        db.add(user)
        db.flush()
        db.add(LoginIdentity(user_id=user.id, provider="email", normalized_identifier=email, display_identifier=email, verified_at=now))
        users.append(user)
    family = Family(name="E2E Family", created_by=users[0].id)
    db.add(family)
    db.flush()
    db.add_all([FamilyMember(family_id=family.id, user_id=users[0].id, role="owner"), FamilyMember(family_id=family.id, user_id=users[1].id, role="member")])
    db.commit()
