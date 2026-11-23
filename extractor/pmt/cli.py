"""Command-line entry point:  pmt ingest | rebuild | process-inbox | push | summary | catalog-json."""

from __future__ import annotations

import argparse
import json
import re
import logging
import sys
from collections import Counter
from pathlib import Path

from . import catalog as catalog_mod
from .llm import LLMConfig
from .pdf import IMAGE_TYPES
from .pipeline import Duplicate, ingest, process_upload, rebuild
from .store import LocalStore, S3Store
from .units import display_transform


def _iter_files(paths: list[str]):
    for p in map(Path, paths):
        if p.is_dir():
            for f in sorted(p.iterdir()):
                if f.suffix.lower() in {".pdf", *IMAGE_TYPES}:
                    yield f
        elif p.is_file():
            yield p


def cmd_ingest(a) -> int:
    store = LocalStore(a.data)
    cfg = LLMConfig()
    if a.model:
        cfg.model = a.model
    if a.effort:
        cfg.effort = a.effort
    total, failed = 0.0, 0
    for f in _iter_files(a.paths):
        print(f"→ {f.name}", flush=True)
        try:
            doc = ingest(store, f.name, f.read_bytes(), cfg, force=a.force, rebuild_after=False)
        except Duplicate as d:
            print(f"   = already ingested as {d.filename} ({d.reason}) — skipped, no cost")
            continue
        except Exception as e:  # noqa: BLE001
            failed += 1
            print(f"   ✗ failed: {e}", file=sys.stderr)
            continue
        total += doc.cost_usd or 0
        print(f"   ✓ {doc.pages} pages · ${doc.cost_usd}")
    out = rebuild(store)
    print(f"\nresults.json: {len(out['results'])} results, {len(out['findings'])} findings, "
          f"{len(out['documents'])} documents · spent ${total:.2f}" + (f" · {failed} failed" if failed else ""))
    return 1 if failed else 0


INBOX_RE = re.compile(r"^inbox/(?P<uid>[0-9a-f-]{36})/(?P<name>[^/]{1,200})$")


def cmd_process_inbox(a) -> int:
    """Local-mode twin of the Lambda: process every file waiting in <data>/inbox/<upload-id>/<name>, reporting
    progress to uploads/<upload-id>.json, then rebuild. Used by the dev server's upload button."""
    store = LocalStore(a.data)
    cfg = LLMConfig()
    n = 0
    while True:  # re-list: files may arrive while we work
        pending = [k for k in store.list("inbox/") if INBOX_RE.match(k)]
        if not pending:
            break
        for key in pending:
            m = INBOX_RE.match(key)
            data = store.get(key)
            store.delete(key)  # never process (and pay for) the same upload twice
            if data is None:
                continue
            state = process_upload(store, m["uid"], m["name"], data, cfg)
            print(f"{m['name']}: {state}", flush=True)
            n += 1
    rebuild(store)  # also picks up corrections.json changes (deletions, replaced reports)
    print(f"processed {n} upload(s)")
    return 0


def cmd_rebuild(a) -> int:
    out = rebuild(LocalStore(a.data))
    print(f"results.json: {len(out['results'])} results, {len(out['findings'])} findings")
    return 0


PUSH_DIRS = ("docs/", "extractions/", "usage/", "status/")
CONTENT_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".webp": "image/webp", ".gif": "image/gif", ".json": "application/json"}
PREFIX_RE = re.compile(r"^(?P<root>users/[\w:-]{10,80}/|circles/[a-z0-9-]{1,30}/)profiles/[a-z0-9-]{1,40}/?$")


def cmd_push(a) -> int:
    """Copy a local profile to S3 (stored originals + transcriptions: no LLM calls), then rebuild there."""
    m = PREFIX_RE.match(a.prefix)
    if not m:
        print("--prefix must look like users/<identity-id>/profiles/<profile> or circles/<id>/profiles/<profile>")
        return 2
    local, remote = LocalStore(a.data), S3Store(a.bucket, a.prefix)
    existing = set(remote.list(""))
    todo = [k for k in local.list("") if k.startswith(PUSH_DIRS)]
    if local.get("corrections.json") is not None:
        if "corrections.json" in existing and remote.get("corrections.json") != local.get("corrections.json") and not a.overwrite:
            print("remote corrections.json differs from the local one: not overwritten (use --overwrite)")
        else:
            todo.append("corrections.json")
    new = [k for k in todo if a.overwrite or k not in existing]
    print(f"{len(todo)} local files, {len(new)} to upload, {len(todo) - len(new)} already in S3")
    # display prefs live in the user's private space: users/<id>/prefs/<profile with / -> ~>.json
    prefs = local.get("prefs.json")
    prefs_key = None
    if prefs is not None and m["root"].startswith("users/"):
        prefs_key = f"{m['root']}prefs/{a.prefix.rstrip('/').split('/')[-1]}.json"
    if a.dry_run:
        for k in new:
            print("  would upload", k)
        if prefs_key:
            print("  would upload prefs ->", prefs_key, "(if absent)")
        return 0
    for i, k in enumerate(new, 1):
        remote.put(k, local.get(k), CONTENT_TYPES.get(Path(k).suffix.lower(), "application/octet-stream"))
        if i % 20 == 0 or i == len(new):
            print(f"  uploaded {i}/{len(new)}")
    if prefs_key:
        s3 = S3Store(a.bucket, "")
        if s3.get(prefs_key) is None:
            s3.put(prefs_key, prefs)
            print("  uploaded display preferences")
    out = rebuild(remote)
    print(f"rebuilt results.json in S3: {len(out['documents'])} documents, {len(out['results'])} results")
    return 0


def cmd_summary(a) -> int:
    res = json.loads((Path(a.data) / "results.json").read_text())
    rs = res["results"]
    st = Counter(r["status"] for r in rs)
    print(f"{len(res['documents'])} documents · {len(rs)} results · {dict(st)} · {len(res['findings'])} findings")
    issues = Counter(i.split(" (")[0].split(" '")[0] for r in rs for i in r.get("issues", []))
    for k, v in issues.most_common():
        print(f"  {v:4d}  {k}")
    unmapped = Counter(r["raw_name"] for r in rs if not r.get("test_id"))
    if unmapped:
        print("unmapped names:", ", ".join(f"{n} ({c})" for n, c in unmapped.most_common(40)))
    return 0


def build_web_catalog() -> dict:
    cat = catalog_mod.load()
    tests = []
    for t in cat.tests.values():
        if t.get("merge_into"):
            continue
        units = {}
        for u in [t["unit"], *(t.get("alt_units") or [])]:
            if u is None:
                continue
            a, b = display_transform(u, t)
            units[u if u else ""] = [a, b]
        tests.append({
            k: v for k, v in {
                "id": t["id"], "name": t["name"], "panel": t["panel"], "unit": t["unit"], "kind": t["kind"],
                "units": units, "decimals": t.get("decimals"), "ref": t.get("ref"), "ref_m": t.get("ref_m"),
                "ref_f": t.get("ref_f"), "log": t.get("log"), "limits": t.get("limits"),
                "aliases": [a for a in (t.get("aliases") or []) if a != t["name"]] or None,  # for search
            }.items() if v is not None
        })
    return {"panels": cat.panels, "tests": tests}


def cmd_catalog_json(a) -> int:
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(build_web_catalog(), ensure_ascii=False, indent=1))
    print(f"wrote {a.out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    p = argparse.ArgumentParser(prog="pmt", description="Labracadabra extractor (pmt)")
    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("ingest", help="extract documents into a local profile folder")
    s.add_argument("paths", nargs="+")
    s.add_argument("--data", required=True, help="profile folder, e.g. ./local-data/me")
    s.add_argument("--model")
    s.add_argument("--effort", choices=["low", "medium", "high", "xhigh", "max"])
    s.add_argument("--force", action="store_true", help="re-extract even if already ingested")
    s.set_defaults(fn=cmd_ingest)

    s = sub.add_parser("rebuild", help="re-normalise stored extractions (no LLM calls)")
    s.add_argument("--data", required=True)
    s.set_defaults(fn=cmd_rebuild)

    s = sub.add_parser("process-inbox", help="process files uploaded to <data>/inbox/ (local mode of the Lambda)")
    s.add_argument("--data", required=True)
    s.set_defaults(fn=cmd_process_inbox)

    s = sub.add_parser("push", help="copy a local profile to S3 (no LLM calls) and rebuild it there")
    s.add_argument("--data", required=True, help="local profile folder, e.g. ./local-data/me")
    s.add_argument("--bucket", required=True, help="the stack's DataBucketName output")
    s.add_argument("--prefix", required=True, help="users/<identity-id>/profiles/<profile>  or  circles/<id>/profiles/<profile>")
    s.add_argument("--overwrite", action="store_true", help="replace files that already exist in S3")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(fn=cmd_push)

    s = sub.add_parser("summary", help="print a quality summary of results.json")
    s.add_argument("--data", required=True)
    s.set_defaults(fn=cmd_summary)

    s = sub.add_parser("catalog-json", help="emit the catalog for the web app")
    s.add_argument("--out", default="../web/src/data/catalog.json")
    s.set_defaults(fn=cmd_catalog_json)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
