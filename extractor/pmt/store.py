"""Storage backends for one profile's data: local folder (dev/CLI) or S3 prefix (production)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol


class PreconditionFailed(RuntimeError):
    pass


class Store(Protocol):
    def get(self, key: str) -> bytes | None: ...
    def put(self, key: str, data: bytes, content_type: str = "application/json", if_match: str | None = None) -> None: ...
    def etag(self, key: str) -> str | None: ...
    def list(self, prefix: str) -> list[str]: ...
    def delete(self, key: str) -> None: ...

    def get_json(self, key: str, default=None): ...
    def put_json(self, key: str, obj, if_match: str | None = None) -> None: ...


class _JsonMixin:
    def get_json(self, key, default=None):
        b = self.get(key)
        return default if b is None else json.loads(b)

    def put_json(self, key, obj, if_match=None):
        self.put(key, json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode(), "application/json", if_match)


class LocalStore(_JsonMixin):
    def __init__(self, root: str | Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _p(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents and p != self.root.resolve():
            raise ValueError("key escapes store root")
        return p

    def get(self, key):
        p = self._p(key)
        return p.read_bytes() if p.exists() else None

    def etag(self, key):
        p = self._p(key)
        return str(p.stat().st_mtime_ns) if p.exists() else None

    def put(self, key, data, content_type="application/json", if_match=None):
        if if_match is not None and self.etag(key) != if_match:
            raise PreconditionFailed(key)
        p = self._p(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(p.suffix + ".tmp")
        tmp.write_bytes(data)
        tmp.replace(p)

    def delete(self, key):
        p = self._p(key)
        if p.exists():
            p.unlink()
        # tidy up folders left empty (e.g. inbox/<upload-id>/), like S3 which has no folders
        root = self.root.resolve()
        for d in p.parents:
            if d == root or root not in d.parents:
                break
            try:
                d.rmdir()  # only succeeds when empty
            except OSError:
                break

    def list(self, prefix):
        base = self._p(prefix) if prefix else self.root
        if not base.exists():
            return []
        return sorted(str(p.relative_to(self.root)) for p in base.rglob("*") if p.is_file() and not p.name.endswith(".tmp"))


class S3Store(_JsonMixin):
    def __init__(self, bucket: str, prefix: str, client=None):
        import boto3

        self.bucket = bucket
        self.prefix = prefix.rstrip("/") + "/"
        self.s3 = client or boto3.client("s3")

    def _k(self, key):
        return self.prefix + key

    def get(self, key):
        try:
            return self.s3.get_object(Bucket=self.bucket, Key=self._k(key))["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None

    def etag(self, key):
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=self._k(key))["ETag"]
        except Exception:  # noqa: BLE001 - 404 surfaces as ClientError
            return None

    def put(self, key, data, content_type="application/json", if_match=None):
        from botocore.exceptions import ClientError

        kw = dict(Bucket=self.bucket, Key=self._k(key), Body=data, ContentType=content_type)
        if content_type == "application/json":
            kw["CacheControl"] = "no-cache"  # rewritten often (results, upload status): browsers must not reuse old copies
        if if_match:
            kw["IfMatch"] = if_match
        try:
            self.s3.put_object(**kw)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("PreconditionFailed", "ConditionalRequestConflict"):
                raise PreconditionFailed(key) from e
            raise

    def delete(self, key):
        self.s3.delete_object(Bucket=self.bucket, Key=self._k(key))

    def list(self, prefix):
        out, token = [], None
        while True:
            kw = dict(Bucket=self.bucket, Prefix=self._k(prefix))
            if token:
                kw["ContinuationToken"] = token
            resp = self.s3.list_objects_v2(**kw)
            out += [o["Key"][len(self.prefix):] for o in resp.get("Contents", [])]
            if not resp.get("IsTruncated"):
                return sorted(out)
            token = resp["NextContinuationToken"]
