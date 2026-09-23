from uuid import uuid4

import pytest

from app.relationships import (
    RelationshipError,
    assert_date_order,
    assert_parent_child_is_acyclic,
    canonical_pair,
)


def test_allows_valid_multi_generation_tree():
    grandparent, parent, child = uuid4(), uuid4(), uuid4()
    assert_parent_child_is_acyclic([(grandparent, parent)], parent, child)


def test_rejects_self_parent():
    person = uuid4()
    with pytest.raises(RelationshipError):
        assert_parent_child_is_acyclic([], person, person)


def test_rejects_cycle_that_closes_existing_ancestry():
    grandparent, parent, child = uuid4(), uuid4(), uuid4()
    with pytest.raises(RelationshipError, match="тойрог"):
        assert_parent_child_is_acyclic([(grandparent, parent), (parent, child)], child, grandparent)


def test_marriage_pair_is_order_independent_and_rejects_self():
    a, b = uuid4(), uuid4()
    assert canonical_pair(a, b) == canonical_pair(b, a)
    with pytest.raises(RelationshipError):
        canonical_pair(a, a)


def test_rejects_impossible_marriage_date_order():
    from datetime import date

    with pytest.raises(RelationshipError):
        assert_date_order(date(2020, 1, 1), date(2019, 1, 1))


def test_health_endpoint_reports_service_ready():
    from fastapi.testclient import TestClient

    from app.main import app

    response = TestClient(app).get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "guulingiinhan-api"}
