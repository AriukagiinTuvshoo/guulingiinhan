from conftest import register_verified


def test_smart_connect_unlink_and_oral_history(client):
    register_verified(client, "smart-tree-owner@example.com")
    family_id = client.post("/api/v1/families", json={"name": "Smart Tree"}).json()["id"]

    father = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Батаа", "last_name": "Дорж", "gender": "male"},
    ).json()
    mother = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Цэцэг", "last_name": "Сүрэн", "gender": "female"},
    ).json()
    child = client.post(
        f"/api/v1/families/{family_id}/persons",
        json={"first_name": "Болд", "last_name": "Батаа", "gender": "male"},
    ).json()

    # Smart-connect child as son of father with mother as co-parent
    connect = client.post(
        f"/api/v1/families/{family_id}/relationships/smart-connect",
        json={
            "anchor_person_id": father["id"],
            "target_person_id": child["id"],
            "role": "son",
            "co_parent_id": mother["id"],
            "auto_marry_coparent": True,
        },
    )
    assert connect.status_code == 201
    data = connect.json()
    assert data["created_parent_child_edges"] == 2
    assert data["created_marriages"] == 1

    # Unlink by (parent_id, child_id) query params
    unlink = client.delete(
        f"/api/v1/families/{family_id}/relationships/parent-child",
        params={"parent_id": mother["id"], "child_id": child["id"]},
    )
    assert unlink.status_code == 204

    # Oral history extraction
    oral = client.post(
        f"/api/v1/families/{family_id}/persons/{father['id']}/oral-history/extract",
        json={
            "narrative_text": "1955 онд Архангай аймагт төрсөн. 1973 онд Улаанбаатар хотод их сургууль төгссөн.",
            "auto_create_events": True,
            "update_biography": True,
        },
    )
    assert oral.status_code == 200
    oral_data = oral.json()
    assert oral_data["biography_updated"] is True
    assert oral_data["created_events_count"] >= 1
    assert len(oral_data["extracted_events"]) >= 1
