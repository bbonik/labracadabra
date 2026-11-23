"""AWS Lambda entry point. Triggered by SQS, which receives S3 ObjectCreated notifications for the data bucket.

Handled keys (everything else, e.g. results.json written by this function, is ignored), where <space> is a user's
private folder  users/<identityId>  or a sharing circle  circles/<circleId>:
  <space>/profiles/<profile>/inbox/<uuid>/<filename>   → extract (progress in uploads/<uuid>.json), delete the inbox copy
  <space>/profiles/<profile>/corrections.json           → rebuild results.json (no LLM call)
"""

from __future__ import annotations

import json
import logging
import os
import re
import urllib.parse

import boto3

from .pipeline import process_upload, rebuild
from .store import S3Store

log = logging.getLogger()
log.setLevel(logging.INFO)

BUCKET = os.environ["DATA_BUCKET"]
MAX_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(40 * 1024 * 1024)))
KEY_RE = re.compile(
    r"^(?P<root>(?:users/(?P<uid>[\w:-]{10,80})|circles/(?P<cid>[a-z0-9-]{1,30}))/profiles/(?P<pid>[a-z0-9-]{1,40}))/"
    r"(?:(?P<inbox>inbox/(?P<uid_inbox>[0-9a-f-]{36})/(?P<name>[^/]{1,200}))|(?P<corr>corrections\.json))$"
)

s3 = boto3.client("s3")
_key_loaded = False


def _load_api_key() -> None:
    """Fetch the Anthropic key from SSM once per container (never logged, never in env config)."""
    global _key_loaded
    if _key_loaded or os.environ.get("PMT_PROVIDER") == "bedrock":
        return
    name = os.environ.get("ANTHROPIC_KEY_PARAM", "/pmt/anthropic-api-key")
    os.environ["ANTHROPIC_API_KEY"] = boto3.client("ssm").get_parameter(Name=name, WithDecryption=True)["Parameter"]["Value"]
    _key_loaded = True


def _records(event):
    for rec in event.get("Records", []):
        body = json.loads(rec.get("body") or "{}")
        for r in body.get("Records", []):  # S3 notification inside the SQS message
            if r.get("eventSource") == "aws:s3":
                yield urllib.parse.unquote_plus(r["s3"]["object"]["key"]), r["s3"]["object"].get("size", 0)


def handler(event, _context):
    for key, size in _records(event):
        m = KEY_RE.match(key)
        if not m:
            continue
        store = S3Store(BUCKET, m["root"], client=s3)
        if m["corr"]:
            log.info("rebuild after corrections: %s", m["root"])
            rebuild(store)  # also applies document deletions / replaced reports
            continue
        name, upload_id = m["name"], m["uid_inbox"]
        try:
            log.info("upload %s (%d bytes)", name, size)
            if size > MAX_BYTES:  # reported as "too large" without downloading it
                process_upload(store, upload_id, name, b"", size=size)
            else:
                _load_api_key()
                data = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
                process_upload(store, upload_id, name, data)  # extraction errors don't raise: no SQS retry, no double pay
        finally:
            s3.delete_object(Bucket=BUCKET, Key=key)
    return {"ok": True}
