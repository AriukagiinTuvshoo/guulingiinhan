from uuid import UUID

import pytest
from conftest import register_verified

from app.models import FamilyMember


@pytest.mark.parametrize("role", ["editor", "member", None])
def test_family_audit_remains_owner_only(client, database, role):
    register_verified(client, "audit-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Audit family"}).json()["id"]
    owner_response = client.get(f"/api/v1/families/{family_id}/audit")
    assert owner_response.status_code == 200
    assert isinstance(owner_response.json(), list)
    client.post("/api/v1/auth/logout")
    register_verified(client, "audit-viewer@example.com")
    viewer_id = client.get("/api/v1/auth/me").json()["id"]
    if role is not None:
        with database() as db:
            db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(viewer_id), role=role))
            db.commit()
    assert client.get(f"/api/v1/families/{family_id}/audit").status_code == 403
