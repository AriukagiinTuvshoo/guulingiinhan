from datetime import UTC, datetime, timedelta
from uuid import UUID

from conftest import register_verified

from app.models import FamilyMember


def login(client, email):
    client.post("/api/v1/auth/logout")
    response = client.post("/api/v1/auth/login", json={
        "email": email, "password": "strong-passphrase-123",
    })
    assert response.status_code == 200


def setup_owner_and_member(client, database):
    assert register_verified(client, "owner@example.com").status_code == 201
    owner = client.get("/api/v1/auth/me").json()
    family = client.post("/api/v1/families", json={"name": "Удам"}).json()
    client.post("/api/v1/auth/logout")
    assert register_verified(client, "member@example.com").status_code == 201
    member = client.get("/api/v1/auth/me").json()
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family["id"]), user_id=UUID(member["id"]), role="member"))
        db.commit()
    login(client, "owner@example.com")
    return owner, member, family


def test_fund_manual_donation_flow_is_family_scoped_and_private(client, database):
    _, _member, family = setup_owner_and_member(client, database)
    fid = family["id"]
    fund = client.post(f"/api/v1/families/{fid}/funds", json={
        "title": "Нэгдсэн сан", "purpose": "Гэр бүлийн цугларалт",
        "currency": "mnt", "payment_instruction": "Банкны шилжүүлэг",
    })
    assert fund.status_code == 201
    assert fund.json()["currency"] == "MNT"

    login(client, "member@example.com")
    created = client.post(f"/api/v1/families/{fid}/funds/{fund.json()['id']}/donations", json={
        "amount_minor": 500000, "private_donor": True,
    })
    assert created.status_code == 201
    donation = created.json()
    assert donation["donor_name"] is None and donation["status"] == "pledged"
    assert len(client.get(f"/api/v1/families/{fid}/funds/{fund.json()['id']}/donations").json()) == 1
    other_family = client.post("/api/v1/families", json={"name": "Өөр удам"}).json()
    assert client.get(f"/api/v1/families/{other_family['id']}/funds").json() == []
    assert client.post(f"/api/v1/families/{other_family['id']}/funds/{fund.json()['id']}/donations", json={
        "amount_minor": 500000,
    }).status_code == 404
    assert client.post(f"/api/v1/families/{fid}/funds/{fund.json()['id']}/donations/{donation['id']}/report").status_code == 200
    assert client.post(f"/api/v1/families/{fid}/funds/{fund.json()['id']}/donations/{donation['id']}/report").status_code == 409

    login(client, "owner@example.com")
    confirmed = client.post(f"/api/v1/families/{fid}/funds/{fund.json()['id']}/donations/{donation['id']}/confirm")
    assert confirmed.status_code == 200 and confirmed.json()["status"] == "confirmed"
    assert confirmed.json()["donor_name"] is None


def test_family_event_registration_payment_and_capacity(client, database):
    _, _member, family = setup_owner_and_member(client, database)
    fid = family["id"]
    starts = datetime.now(UTC) + timedelta(days=30)
    event = client.post(f"/api/v1/families/{fid}/events", json={
        "title": "Жилийн уулзалт", "starts_at": starts.isoformat(),
        "registration_deadline": (starts - timedelta(days=1)).isoformat(),
        "location": "Улаанбаатар", "capacity": 3,
        "adult_fee_minor": 500000, "child_fee_minor": 200000,
        "currency": "MNT", "payment_instruction": "Бэлэн бус шилжүүлэг",
    })
    assert event.status_code == 201
    eid = event.json()["id"]
    assert client.post(f"/api/v1/families/{fid}/events", json={
        "title": "Timezone дутуу", "starts_at": "2030-01-01T10:00:00",
        "location": "Улаанбаатар",
    }).status_code == 422

    login(client, "member@example.com")
    registration = client.post(f"/api/v1/families/{fid}/events/{eid}/registrations", json={
        "adult_count": 1, "child_count": 2,
    })
    assert registration.status_code == 201
    assert registration.json()["payment_status"] == "unpaid"
    assert client.get(f"/api/v1/families/{fid}/events/{eid}/registrations/me").json()["id"] == registration.json()["id"]
    assert client.post(f"/api/v1/families/{fid}/events/{eid}/registrations", json={
        "adult_count": 1, "child_count": 0,
    }).status_code == 409
    assert client.post(f"/api/v1/families/{fid}/events/{eid}/registrations/me/report-payment").status_code == 200

    login(client, "owner@example.com")
    reg = registration.json()
    assert client.post(f"/api/v1/families/{fid}/events/{eid}/registrations/{reg['id']}/confirm-payment").status_code == 200
    login(client, "member@example.com")
    assert client.post(f"/api/v1/families/{fid}/events/{eid}/registrations/me/cancel").status_code == 409

    login(client, "owner@example.com")
    second = client.post(f"/api/v1/families/{fid}/events", json={
        "title": "Бага багтаамжтай", "starts_at": starts.isoformat(),
        "location": "Талбай", "capacity": 1,
    }).json()
    login(client, "member@example.com")
    assert client.post(f"/api/v1/families/{fid}/events/{second['id']}/registrations", json={
        "adult_count": 0, "child_count": 2,
    }).status_code == 409
    login(client, "owner@example.com")
    cancellable = client.post(f"/api/v1/families/{fid}/events", json={
        "title": "Цуцалж болох уулзалт", "starts_at": starts.isoformat(), "location": "Талбай",
    }).json()
    login(client, "member@example.com")
    cancel_event_id = cancellable["id"]
    assert client.post(f"/api/v1/families/{fid}/events/{cancel_event_id}/registrations", json={
        "adult_count": 1, "child_count": 0,
    }).status_code == 201
    assert client.post(f"/api/v1/families/{fid}/events/{cancel_event_id}/registrations/me/cancel").status_code == 204
    assert client.post(f"/api/v1/families/{fid}/events/{cancel_event_id}/registrations", json={
        "adult_count": 1, "child_count": 1,
    }).status_code == 200
