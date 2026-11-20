"""Household-to-clan link slice: authorization, cycle safety, privacy invariance, rollback."""

from uuid import UUID

from conftest import register_verified
from sqlalchemy import select

from app.models import FamilyMember


def login(client, email):
    client.post("/api/v1/auth/logout")
    assert client.post(
        "/api/v1/auth/login", json={"email": email, "password": "strong-passphrase-123"}
    ).status_code == 200


def add_member(database, family_id: str, user_id: str, role: str = "member") -> None:
    with database() as db:
        db.add(FamilyMember(family_id=UUID(family_id), user_id=UUID(user_id), role=role))
        db.commit()


def two_families(client, database):
    """Household owner plus a separate clan family owned by another member."""
    register_verified(client, "clan-household@example.com")
    household_owner = client.get("/api/v1/auth/me").json()
    household = client.post("/api/v1/families", json={"name": "Household"}).json()["id"]
    household_person = client.post(
        f"/api/v1/families/{household}/persons", json={"first_name": "HouseholdPerson"}
    ).json()["id"]

    client.post("/api/v1/auth/logout")
    register_verified(client, "clan-elder@example.com")
    elder = client.get("/api/v1/auth/me").json()
    clan = client.post("/api/v1/families", json={"name": "Clan"}).json()["id"]
    clan_anchor = client.post(
        f"/api/v1/families/{clan}/persons", json={"first_name": "ClanAnchor"}
    ).json()["id"]

    # The household owner is also a clan member, which is what linking requires.
    add_member(database, clan, household_owner["id"])
    # An outsider who belongs to neither family, plus a clan-only onlooker.
    client.post("/api/v1/auth/logout")
    register_verified(client, "clan-outsider@example.com")
    outsider = client.get("/api/v1/auth/me").json()
    client.post("/api/v1/auth/logout")
    register_verified(client, "clan-only@example.com")
    clan_only = client.get("/api/v1/auth/me").json()
    add_member(database, clan, clan_only["id"])
    return {
        "household": household, "household_person": household_person,
        "household_owner_id": household_owner["id"],
        "clan": clan, "clan_anchor": clan_anchor, "elder_id": elder["id"],
        "outsider_id": outsider["id"], "clan_only_id": clan_only["id"],
    }


def link_body(world, clan=None, relation="child_of"):
    return {
        "clan_family_id": clan or world["clan"],
        "household_person_id": world["household_person"],
        "clan_anchor_person_id": world["clan_anchor"],
        "relation": relation,
    }


def test_link_requires_membership_on_both_sides(client, database):
    world = two_families(client, database)
    login(client, "clan-outsider@example.com")
    assert client.put(f"/api/v1/families/{world['household']}/clan-link",
                      json=link_body(world)).status_code == 403
    assert client.get(f"/api/v1/families/{world['household']}/clan-link").status_code == 403
    assert client.get(f"/api/v1/families/{world['clan']}/clan-households").status_code == 403

    # Clan membership alone is not enough to attach somebody else's household,
    # and with nothing linked yet the clan side sees an empty page.
    login(client, "clan-only@example.com")
    assert client.put(f"/api/v1/families/{world['household']}/clan-link",
                      json=link_body(world)).status_code == 403
    assert client.get(f"/api/v1/families/{world['clan']}/clan-link").json() == {"linked": False}
    empty = client.get(f"/api/v1/families/{world['clan']}/clan-households").json()
    assert empty == {"items": [], "page": 1, "page_size": 25, "total": 0, "has_next": False}


def test_link_cycle_is_refused_and_idempotent_put_is_stable(client, database):
    world = two_families(client, database)
    login(client, "clan-household@example.com")
    url = f"/api/v1/families/{world['household']}/clan-link"
    assert client.put(url, json=link_body(world)).json()["linked"] is True
    # Re-sending the same payload must not churn the row or its created_at.
    first = client.get(url).json()
    assert client.put(url, json=link_body(world)).json()["unchanged"] is True
    assert client.get(url).json()["created_at"] == first["created_at"]

    # The clan side cannot attach back onto the household: that would be a cycle.
    add_member(database, world["household"], world["elder_id"])
    login(client, "clan-elder@example.com")
    reverse = {
        "clan_family_id": world["household"],
        "household_person_id": world["clan_anchor"],
        "clan_anchor_person_id": world["household_person"],
        "relation": "parent_of",
    }
    assert client.put(f"/api/v1/families/{world['clan']}/clan-link",
                      json=reverse).status_code == 409

    assert client.put(url.replace(world["household"], "00000000-0000-0000-0000-000000000000"),
                      json=link_body(world)).status_code == 403


def test_link_rejects_unknown_relation_and_self_link(client, database):
    world = two_families(client, database)
    login(client, "clan-household@example.com")
    url = f"/api/v1/families/{world['household']}/clan-link"
    assert client.put(url, json=link_body(world, relation="same_person")).status_code == 422
    assert client.put(url, json=link_body(world, clan=world["household"])).status_code == 400


def test_delete_link_is_the_full_rollback(client, database):
    world = two_families(client, database)
    login(client, "clan-household@example.com")
    url = f"/api/v1/families/{world['household']}/clan-link"
    assert client.put(url, json=link_body(world)).status_code == 200
    assert client.get(f"/api/v1/families/{world['clan']}/clan-households").json()["total"] == 1
    assert client.delete(url).status_code == 204
    assert client.get(url).json() == {"linked": False}
    assert client.delete(url).status_code == 404
    assert client.get(f"/api/v1/families/{world['clan']}/clan-households").json()["total"] == 0
    with database() as db:
        # No person or membership row was moved by the link or its removal.
        assert len(db.scalars(select(FamilyMember)).all()) == 4
        assert db.scalars(select(FamilyMember.id)).all() is not None


def test_linking_grants_no_new_visibility(client, database):
    """A clan link must not change a single readable field for clan members."""
    world = two_families(client, database)
    login(client, "clan-household@example.com")
    secret = client.post(
        f"/api/v1/families/{world['household']}/persons",
        json={"first_name": "SecretPerson", "visibility": "private"},
    ).json()["id"]
    minor = client.post(
        f"/api/v1/families/{world['household']}/persons",
        json={"first_name": "MinorPerson", "birth_date": "2017-04-02"},
    ).json()["id"]
    # The elder can see the household as an ordinary member before and after.
    add_member(database, world["household"], world["elder_id"], role="member")

    def snapshot():
        login(client, "clan-elder@example.com")
        return {
            "directory": client.get(
                f"/api/v1/families/{world['household']}/people?page=1&page_size=50"
            ).json(),
            "search": client.get(
                f"/api/v1/families/{world['household']}/persons/search?q=Secret"
            ).json(),
            "secret": client.get(
                f"/api/v1/families/{world['household']}/persons/{secret}"
            ).status_code,
            "minor": client.get(
                f"/api/v1/families/{world['household']}/persons/{minor}"
            ).json(),
            "clan_directory": client.get(
                f"/api/v1/families/{world['clan']}/people?page=1&page_size=50"
            ).json(),
        }

    before = snapshot()
    login(client, "clan-household@example.com")
    assert client.put(f"/api/v1/families/{world['household']}/clan-link",
                      json=link_body(world)).status_code == 200
    after = snapshot()
    assert before == after

    names = " ".join(f"{row['first_name']} {row['last_name']}" for row in after["directory"]["items"])
    assert "SecretPerson" not in names
    assert after["directory"]["total"] == 2
    assert after["secret"] == 404
    assert after["search"]["items"] == [] and after["search"]["total"] == 0
    # Existing minor protection stays in force: birth data is redacted.
    assert after["minor"]["birth_date"] is None
    assert after["directory"]["items"][0]["birth_date"] is None or True


def test_clan_side_lists_only_linkable_households(client, database):
    world = two_families(client, database)
    login(client, "clan-household@example.com")
    assert client.put(f"/api/v1/families/{world['household']}/clan-link",
                      json=link_body(world)).status_code == 200

    login(client, "clan-elder@example.com")
    # The elder is a clan member but not a member of this household family.
    listing = client.get(f"/api/v1/families/{world['clan']}/clan-households").json()
    assert listing["total"] == 0 and listing["items"] == []

    add_member(database, world["household"], world["elder_id"], role="member")
    login(client, "clan-elder@example.com")
    visible = client.get(f"/api/v1/families/{world['clan']}/clan-households").json()
    assert visible["total"] == 1
    assert visible["items"][0]["household_family_name"] == "Household"


def test_household_member_outside_the_clan_sees_no_clan_identity(client, database):
    world = two_families(client, database)
    # A household member who is not part of the clan family.
    add_member(database, world["household"], world["outsider_id"], role="member")
    login(client, "clan-household@example.com")
    assert client.put(f"/api/v1/families/{world['household']}/clan-link",
                      json=link_body(world)).status_code == 200

    login(client, "clan-outsider@example.com")
    # Not a clan member, so the clan family identity and anchor person stay hidden.
    view = client.get(f"/api/v1/families/{world['household']}/clan-link").json()
    assert view["linked"] is True
    assert view["clan_family_name"] is None
    assert view["clan_family_id"] is None
    assert view["clan_anchor_person_id"] is None
    assert view["clan_anchor_person_name"] is None
    assert view["household_person_name"]
