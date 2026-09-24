from index import app as vercel_app
from app.main import app


def test_vercel_entrypoint_exports_fastapi_application():
    assert vercel_app is app
