from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.maintenance import prune_expired_auth_artifacts
from app.models import User, UserSession


def test_maintenance_dry_run_and_explicit_apply(database):
    now = datetime.now(UTC)
    with database() as db:
        user = User(email="maintenance@example.com", display_name="Test", password_hash="hash")
        db.add(user)
        db.flush()
        db.add_all([
            UserSession(user_id=user.id, token_hash="expired", expires_at=now - timedelta(days=1)),
            UserSession(user_id=user.id, token_hash="active", expires_at=now + timedelta(days=1)),
        ])
        db.commit()
        assert prune_expired_auth_artifacts(db, now=now)["sessions"] == 1
        assert len(db.scalars(select(UserSession)).all()) == 2
        assert prune_expired_auth_artifacts(db, apply=True, now=now)["sessions"] == 1
        db.commit()
        assert [s.token_hash for s in db.scalars(select(UserSession)).all()] == ["active"]
