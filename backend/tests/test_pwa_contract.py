from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def test_manifest_has_install_metadata_and_required_icons():
    manifest = (ROOT / "app" / "manifest.ts").read_text(encoding="utf-8")
    for required in ("name:", "short_name:", "start_url:", "display: 'standalone'", "theme_color:", "background_color:"):
        assert required in manifest
    for dimension, icon in ((192, "icon-192.png"), (512, "icon-512.png")):
        assert f"{dimension}x{dimension}" in manifest
        with Image.open(ROOT / "public" / icon) as image:
            assert image.size == (dimension, dimension)


def test_service_worker_allowlists_public_assets_only():
    worker = (ROOT / "public" / "sw.js").read_text(encoding="utf-8")
    assert "const PUBLIC_ASSETS = ['/', '/icon-192.png', '/icon-512.png']" in worker
    assert "url.origin !== self.location.origin" in worker
    assert "event.request.method !== 'GET'" in worker
    assert "if (!PUBLIC_ASSETS.includes(url.pathname)) return" in worker
    assert "Authenticated pages, API responses, photos and private records are never cached." in worker
