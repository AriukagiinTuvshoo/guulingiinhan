"""Private object storage adapters used by photo APIs."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import Protocol

from app.config import get_settings


def _validate_key(key: str) -> str:
    if not isinstance(key, str) or not key or "\\" in key or "\x00" in key:
        raise ValueError("Invalid object key")
    parts = key.split("/")
    windows_path = PureWindowsPath(key)
    if (
        any(part in {"", ".", ".."} for part in parts)
        or PurePosixPath(key).is_absolute()
        or windows_path.is_absolute()
        or windows_path.drive
    ):
        raise ValueError("Invalid object key")
    return key


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...

    def delete(self, key: str) -> None: ...


class LocalObjectStorage:
    """Filesystem adapter for local development and tests."""

    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()

    def _path(self, key: str) -> Path:
        key = _validate_key(key)
        path = (self.root / PurePosixPath(key)).resolve()
        if path == self.root or self.root not in path.parents:
            raise ValueError("Invalid object key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)


class S3ObjectStorage:
    """S3-compatible private bucket adapter (AWS S3, Cloudflare R2, etc.)."""

    def __init__(self, endpoint: str, bucket: str, region: str, access_key: str, secret_key: str):
        try:
            import boto3
            from botocore.config import Config
        except ImportError as error:  # pragma: no cover - dependency install check
            raise RuntimeError("S3 storage requires boto3") from error
        self.bucket = bucket
        self.client = boto3.client(
            "s3", endpoint_url=endpoint, region_name=region,
            aws_access_key_id=access_key, aws_secret_access_key=secret_key,
            config=Config(
                signature_version="s3v4",
                connect_timeout=3,
                read_timeout=10,
                retries={"max_attempts": 3, "mode": "standard"},
                s3={"addressing_style": "path"},
            ),
        )

    def put(self, key: str, data: bytes, content_type: str) -> None:
        key = _validate_key(key)
        self.client.put_object(Bucket=self.bucket, Key=key, Body=data, ContentType=content_type)

    def get(self, key: str) -> bytes:
        key = _validate_key(key)
        return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()

    def exists(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        key = _validate_key(key)
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as error:
            if error.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
                return False
            raise

    def delete(self, key: str) -> None:
        key = _validate_key(key)
        self.client.delete_object(Bucket=self.bucket, Key=key)


@lru_cache(maxsize=1)
def get_storage() -> ObjectStorage:
    settings = get_settings()
    if settings.storage_provider.lower() == "local":
        return LocalObjectStorage(settings.storage_local_path)
    if not all((settings.storage_endpoint, settings.storage_bucket,
                settings.storage_access_key, settings.storage_secret_key)):
        raise RuntimeError("S3 storage configuration is incomplete")
    return S3ObjectStorage(
        settings.storage_endpoint,
        settings.storage_bucket,
        settings.storage_region,
        settings.storage_access_key,
        settings.storage_secret_key,
    )
