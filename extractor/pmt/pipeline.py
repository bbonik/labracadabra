"""End-to-end: document bytes → extraction → results.json (idempotent, re-buildable)."""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Callable

from . import catalog as catalog_mod
from . import pdf
from .llm import Extractor, LLMConfig, Usage
from .merge import merge
from .normalize import normalize_document
from .prompt import build_system
from .schema import Document, RawExtraction
from .store import PreconditionFailed, Store

log = logging.getLogger(__name__)

EXT = {"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}
ALLOWED_EXT = (".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif")
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
# Cost guard: every page is sent to the model, so a huge PDF (by mistake or abuse) is refused before any LLM call.
# Long check-up reports run to ~60 pages; raise it with PMT_MAX_PAGES if yours are longer.
DEFAULT_MAX_PAGES = 100


def max_pages() -> int:
    try:
        return max(1, int(os.environ.get("PMT_MAX_PAGES", DEFAULT_MAX_PAGES)))
    except ValueError:
        return DEFAULT_MAX_PAGES

Progress = Callable[..., None]  # progress(state, **details)


class Duplicate(Exception):
    """The document is already in the store (same bytes, or same text content). Nothing was extracted or paid."""

    def __init__(self, doc_id: str, filename: str, reason: str):
        super().__init__(f"already ingested as {filename} ({reason})")
        self.doc_id, self.filename, self.reason = doc_id, filename, reason


class TooManyPages(ValueError):
    """The document has more pages than PMT_MAX_PAGES allows. Nothing was stored or paid."""

    def __init__(self, pages: int, limit: int):
        super().__init__(f"{pages} pages (max {limit}); split the file or raise PMT_MAX_PAGES")
        self.pages, self.limit = pages, limit


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def doc_id_for(data: bytes) -> tuple[str, str]:
    sha = hashlib.sha256(data).hexdigest()
    return sha[:16], sha


def set_status(store: Store, doc_id: str, status: str, **extra) -> None:
    store.put_json(f"status/{doc_id}.json", {"doc_id": doc_id, "status": status, "at": _now(), **extra})


def record_spend(store: Store, doc_id: str, filename: str, pages: int, model: str, usage: Usage, status: str,
                 at: str | None = None, cost: float | None = None) -> None:
    """Append-only spend log: one small object per extraction run (no read-modify-write, so concurrent Lambda runs
    can't lose entries). Survives document removal and failed runs, so the Usage page shows what was really spent."""
    at = at or _now()
    store.put_json(f"usage/{at.replace(':', '').replace('-', '')[:15]}-{doc_id}.json", {
        "at": at, "doc_id": doc_id, "filename": filename, "pages": pages, "model": model, "status": status,
        "usage": usage.as_dict(), "cost_usd": cost if cost is not None else usage.cost(model),
    })


def _find_by_content(store: Store, content_sha: str) -> dict | None:
    """Document record of an already-extracted document with the same content fingerprint, if any."""
    for key in store.list("extractions/"):
        if key.endswith(".json"):
            d = (store.get_json(key) or {}).get("document", {})
            if d.get("content_sha") == content_sha:
                return d
    return None


def ingest(
    store: Store,
    filename: str,
    data: bytes,
    cfg: LLMConfig | None = None,
    force: bool = False,
    rebuild_after: bool = True,
    workers: int = 4,
    progress: Progress | None = None,
) -> Document:
    """Extract one document into `store`. Raises Duplicate (before any LLM call) if it is already there."""
    report = progress or (lambda *_a, **_k: None)
    cat = catalog_mod.load()
    doc_id, sha = doc_id_for(data)
    if not force:
        existing = store.get_json(f"extractions/{doc_id}.json")
        if existing is not None:
            raise Duplicate(doc_id, existing["document"].get("filename", doc_id), "identical file")

    media_type = pdf.media_type_for(filename, data)
    content_sha = pdf.content_fingerprint(data, media_type)
    if not force:
        dup = _find_by_content(store, content_sha)
        if dup:
            raise Duplicate(dup.get("id", ""), dup.get("filename") or dup.get("id", ""), "same content")
    n_pages = pdf.page_count(data, media_type)
    if n_pages > max_pages():
        raise TooManyPages(n_pages, max_pages())
    key = f"docs/{doc_id}.{EXT[media_type]}"
    if store.get(key) is None:
        store.put(key, data, media_type)

    cfg = cfg or LLMConfig()
    extractor = Extractor(build_system(cat), cfg)
    chunks = pdf.split(data, media_type)
    set_status(store, doc_id, "processing", filename=filename, pages=n_pages)
    done, lock = [0], threading.Lock()
    report("processing", doc_id=doc_id, pages=n_pages, chunks_done=0, chunks_total=len(chunks))

    def run(c):
        r = extractor.extract(c, usage)
        with lock:
            done[0] += 1
            report("processing", doc_id=doc_id, pages=n_pages, chunks_done=done[0], chunks_total=len(chunks))
        return r

    usage = Usage()
    t0 = time.time()
    doc = Document(id=doc_id, filename=filename, sha256=sha, content_sha=content_sha, pages=n_pages, media_type=media_type,
                   uploaded_at=_now(), status="processing", model=extractor.model)
    try:
        # first chunk alone so the system prompt is written to the cache, then the rest in parallel
        raws: list[RawExtraction] = [run(chunks[0])]
        if len(chunks) > 1:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                raws += list(ex.map(run, chunks[1:]))
    except Exception as e:  # noqa: BLE001
        doc.status, doc.error = "failed", str(e)[:500]
        record_spend(store, doc_id, filename, n_pages, extractor.model, usage, "failed")  # partial runs cost money too
        set_status(store, doc_id, "failed", filename=filename, error=doc.error, pages=n_pages)
        raise

    doc.status = "done"
    doc.usage = usage.as_dict()
    doc.cost_usd = usage.cost(cfg.model)
    record_spend(store, doc_id, filename, n_pages, extractor.model, usage, "done")
    store.put_json(f"extractions/{doc_id}.json", {"document": doc.model_dump(), "chunks": [r.model_dump() for r in raws]})
    log.info("extracted %s (%d pages) in %.0fs, $%s", filename, n_pages, time.time() - t0, doc.cost_usd)
    if rebuild_after:
        rebuild(store)
    set_status(store, doc_id, "done", filename=filename, cost_usd=doc.cost_usd)
    return doc


def process_upload(store: Store, upload_id: str, filename: str, data: bytes, cfg: LLMConfig | None = None,
                   size: int | None = None) -> str:
    """One uploaded file, end to end, reporting progress to uploads/<upload_id>.json for the UI.
    Shared by the Lambda (S3 inbox) and local mode (dev-server inbox). Returns the final state."""
    key = f"uploads/{upload_id}.json"
    size = len(data) if size is None else size
    base = {"upload_id": upload_id, "filename": filename, "bytes": size}

    def report(state: str, **extra) -> None:
        try:
            store.put_json(key, {**base, "state": state, "at": _now(), **extra})
        except Exception:  # noqa: BLE001 - progress must never break processing
            log.exception("could not write upload status")

    if not filename.lower().endswith(ALLOWED_EXT):
        report("rejected", error="Only PDF and image files (PNG, JPG, WebP, GIF) are supported.")
        return "rejected"
    if size > MAX_UPLOAD_BYTES:
        report("rejected", error=f"File too large ({size // 2**20} MB, max {MAX_UPLOAD_BYTES // 2**20} MB).")
        return "rejected"
    try:
        doc = ingest(store, filename, data, cfg, rebuild_after=False, progress=report)
    except TooManyPages as t:
        report("rejected", error=f"Too many pages ({t.pages}, max {t.limit}). Split the file into smaller parts.")
        return "rejected"
    except Duplicate as d:
        report("duplicate", doc_id=d.doc_id, duplicate_of=d.filename, reason=d.reason)
        return "duplicate"
    except Exception as e:  # noqa: BLE001 - recorded for the UI; never retried (it would pay twice)
        log.exception("extraction failed for %s", filename)
        rebuild(store)
        report("failed", error=str(e)[:300])
        return "failed"
    out = rebuild(store)
    n = sum(1 for r in out["results"] if r["doc_id"] == doc.id)
    d = next((x for x in out["documents"] if x["id"] == doc.id), {})
    report("done", doc_id=doc.id, values=n, cost_usd=doc.cost_usd, pages=doc.pages,
           duplicate_of=d.get("duplicate_of"), collected_date=d.get("collected_date"))
    return "done"


def _apply_deletions(store: Store, corrections: dict) -> None:
    """corrections.documents[id] = {"action": "delete", "uploaded_at": …} removes that upload's files. Only copies
    uploaded at or before that time are removed, so re-uploading the same report later works (no rewrite of
    corrections.json needed, which would race with the browser)."""
    for doc_id, c in (corrections.get("documents") or {}).items():
        if c.get("action") != "delete":
            continue
        cutoff = c.get("uploaded_at") or ""
        blob = store.get_json(f"extractions/{doc_id}.json")
        st = store.get_json(f"status/{doc_id}.json") or {}
        uploaded = (blob or {}).get("document", {}).get("uploaded_at") or st.get("at") or ""
        if blob is None and not st:
            continue
        if cutoff and uploaded > cutoff:
            continue  # a newer upload of the same file: keep it
        for k in [f"extractions/{doc_id}.json", f"status/{doc_id}.json", *(f"docs/{doc_id}.{e}" for e in EXT.values())]:
            if store.get(k) is not None:
                store.delete(k)
        log.info("deleted document %s", doc_id)


def rebuild(store: Store, retries: int = 5) -> dict:
    """Re-normalise every stored extraction (no LLM calls) and write results.json atomically."""
    cat = catalog_mod.load()
    for attempt in range(retries):
        etag = store.etag("results.json")
        corrections = store.get_json("corrections.json", {}) or {}
        _apply_deletions(store, corrections)
        profile = store.get_json("profile.json", {}) or {}
        aliases = corrections.get("aliases", {})
        docs, per_results, per_findings = [], [], []
        for key in store.list("extractions/"):
            if not key.endswith(".json"):
                continue
            blob = store.get_json(key)
            doc = Document.model_validate(blob["document"])
            chunks = [RawExtraction.model_validate(c) for c in blob["chunks"]]
            results, findings, meta = normalize_document(doc.id, chunks, cat, aliases, profile.get("sex"))
            doc.collected_date = meta["collected_date"]
            doc.report_date = meta["report_date"]
            doc.labs = meta["labs"]
            doc.page_types = meta["page_types"]
            docs.append(doc)
            per_results.append(results)
            per_findings.append(findings)
        known = {d.id for d in docs}
        for key in store.list("status/"):
            st = store.get_json(key) or {}
            if st.get("status") == "failed" and st.get("doc_id") not in known:
                docs.append(Document(id=st["doc_id"], filename=st.get("filename", "?"), sha256="", pages=st.get("pages", 0),
                                     media_type="application/pdf", uploaded_at=st.get("at", ""), status="failed",
                                     error=st.get("error")))
        out = merge(docs, per_results, per_findings, cat, corrections)
        out["spend"] = sorted((store.get_json(k) or {} for k in store.list("usage/") if k.endswith(".json")),
                              key=lambda s: s.get("at", ""))
        try:
            store.put_json("results.json", out, if_match=etag)
            return out
        except PreconditionFailed:
            log.warning("results.json changed concurrently; retrying (%d)", attempt + 1)
            time.sleep(0.5 * (attempt + 1))
    raise RuntimeError("could not write results.json after retries")
