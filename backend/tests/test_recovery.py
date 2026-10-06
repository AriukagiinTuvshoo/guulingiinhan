import base64
import hashlib
import json

import pytest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ops.recovery import MEDIA_FORMAT, export_sql, restore_media, validate_restore_url


@pytest.mark.parametrize("url", [
    "postgresql://u:p@production.invalid/guulingiinhan_restore_test",
    "postgresql://u:p@127.0.0.1/guulingiinhan",
    "sqlite:///guulingiinhan_restore_test",
    "postgresql://u:p@127.0.0.1/",
])
def test_restore_cannot_target_live_or_non_postgres_database(url):
    with pytest.raises(ValueError):
        validate_restore_url(url)


def test_restore_requires_explicit_disposable_local_database():
    validate_restore_url("postgresql+psycopg://u:p@127.0.0.1:5447/guulingiinhan_restore_test")


def test_export_rejects_private_key_and_sql_delimiter():
    with pytest.raises(ValueError):
        export_sql("-----BEGIN PGP PRIVATE KEY BLOCK-----")
    with pytest.raises(ValueError):
        export_sql("-----BEGIN PGP PUBLIC KEY BLOCK-----$recovery_public_key$")


@pytest.fixture(scope="module")
def recovery_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def envelope(key, path="families/test/memories/test/photos/test/original", checksum=None):
    body = b"\xff\xd8\x00\x81\xfe binary private photograph"
    secret = AESGCM.generate_key(bit_length=256)
    nonce = b"123456789012"
    payload = json.dumps({"key": path, "body": base64.b64encode(body).decode(),
                          "sha256": checksum or hashlib.sha256(body).hexdigest(),
                          "http_metadata": {"contentType": "image/jpeg"}}).encode()
    wrapped = key.public_key().encrypt(secret, padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()), algorithm=hashes.SHA256(), label=None,
    ))
    result = {"format": MEDIA_FORMAT, "wrapped_key": base64.b64encode(wrapped).decode(),
              "nonce": base64.b64encode(nonce).decode(), "ciphertext": base64.b64encode(
                  AESGCM(secret).encrypt(nonce, payload, MEDIA_FORMAT.encode())).decode()}
    return result, body


def pem(key):
    return key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                             serialization.NoEncryption())


def test_private_media_roundtrip_preserves_binary_bytes(recovery_key, tmp_path):
    encrypted, original = envelope(recovery_key)
    result = restore_media(encrypted, pem(recovery_key), tmp_path)
    assert (tmp_path / result["key"]).read_bytes() == original
    assert result["sha256"] == hashlib.sha256(original).hexdigest()


def test_media_tampering_writes_nothing(recovery_key, tmp_path):
    encrypted, _ = envelope(recovery_key)
    cipher = bytearray(base64.b64decode(encrypted["ciphertext"]))
    cipher[0] ^= 1
    encrypted["ciphertext"] = base64.b64encode(cipher).decode()
    with pytest.raises(InvalidTag):
        restore_media(encrypted, pem(recovery_key), tmp_path)
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("path", ["../escape.jpg", "/absolute.jpg", "families/../../escape.jpg"])
def test_media_restore_rejects_path_traversal(recovery_key, tmp_path, path):
    encrypted, _ = envelope(recovery_key, path=path)
    with pytest.raises(ValueError):
        restore_media(encrypted, pem(recovery_key), tmp_path)


def test_media_checksum_mismatch_writes_nothing(recovery_key, tmp_path):
    encrypted, _ = envelope(recovery_key, checksum="0" * 64)
    with pytest.raises(ValueError, match="checksum"):
        restore_media(encrypted, pem(recovery_key), tmp_path)
    assert not list(tmp_path.iterdir())
