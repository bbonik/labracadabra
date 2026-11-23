"""Upload processing (progress, duplicates, rejection), duplicate documents, corrected versions, deletion."""

import pytest

from pmt import catalog as C
from pmt import pipeline
from pmt.merge import merge
from pmt.normalize import normalize_document
from pmt.schema import Document, RawExtraction
from pmt.store import LocalStore

cat = C.load()
PNG = b"\x89PNG\r\n\x1a\n"


def raw(results, collected="2025-11-01"):
    return RawExtraction.model_validate({
        "pages": [{"page": 1, "type": "lab_results"}],
        "report": {"collected_date": collected, "lab_name": "Lab", "patient_sex": "M"},
        "results": [{"page": 1, "raw_name": n, "value": v, "unit": u, "catalog_id": c, "source_text": f"{n} {v}"}
                    for n, v, u, c in results],
        "findings": [],
    })


PANEL = [("Sodium", "140", "mmol/L", "sodium"), ("Potassium", "4.2", "mmol/L", "potassium"),
         ("Chloride", "104", "mmol/L", "chloride"), ("Urea", "5.1", "mmol/L", "urea"),
         ("Creatinine", "80", "umol/L", "creatinine"), ("Calcium", "2.3", "mmol/L", "calcium")]


class FakeExtractor:
    """Stands in for the Claude call: returns the same panel for any page."""

    def __init__(self, *_a, **_k):
        self.model = "claude-opus-5-5"

    def extract(self, chunk, usage):
        usage.input_tokens += 1000
        return raw(PANEL)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(pipeline, "Extractor", FakeExtractor)
    return LocalStore(tmp_path)


def test_upload_reports_progress_then_done_and_duplicate_is_free(store):
    assert pipeline.process_upload(store, "u1", "labs.png", PNG + b"one") == "done"
    st = store.get_json("uploads/u1.json")
    assert st["state"] == "done" and st["values"] == len(PANEL) and st["cost_usd"] > 0
    # identical bytes again: duplicate, no second extraction / spend entry
    assert pipeline.process_upload(store, "u2", "copy.png", PNG + b"one") == "duplicate"
    st2 = store.get_json("uploads/u2.json")
    assert st2["duplicate_of"] == "labs.png" and st2["reason"] == "identical file"
    assert len(store.list("usage/")) == 1


def _pdf(pages: int) -> bytes:
    import io

    from pypdf import PdfWriter
    w = PdfWriter()
    for _ in range(pages):
        w.add_blank_page(width=200, height=200)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def test_too_many_pages_is_rejected_before_any_llm_call_or_storage(store, monkeypatch):
    monkeypatch.setenv("PMT_MAX_PAGES", "3")
    assert pipeline.process_upload(store, "u9", "huge.pdf", _pdf(4)) == "rejected"
    st = store.get_json("uploads/u9.json")
    assert "Too many pages (4, max 3)" in st["error"]
    assert store.list("usage/") == [] and store.list("docs/") == []
    assert pipeline.process_upload(store, "u10", "ok.pdf", _pdf(3)) == "done"


def test_unsupported_and_oversized_uploads_are_rejected(store):
    assert pipeline.process_upload(store, "u3", "notes.txt", b"hello") == "rejected"
    assert pipeline.process_upload(store, "u4", "big.pdf", b"", size=pipeline.MAX_UPLOAD_BYTES + 1) == "rejected"
    assert "too large" in store.get_json("uploads/u4.json")["error"]
    assert not store.list("extractions/")


def test_delete_removes_document_but_allows_a_later_reupload(store):
    pipeline.process_upload(store, "u1", "labs.png", PNG + b"x")
    doc = store.get_json("results.json")["documents"][0]
    store.put_json("corrections.json", {"documents": {doc["id"]: {"action": "delete", "uploaded_at": doc["uploaded_at"]}}})
    out = pipeline.rebuild(store)
    assert out["documents"] == [] and out["results"] == [] and not store.list("docs/")
    assert len(out["spend"]) == 1  # the cost stays on record
    # uploading the same file again later is honoured (its upload time is after the deletion cutoff)
    assert pipeline.process_upload(store, "u5", "labs.png", PNG + b"x") == "done"


def _docs(*specs):
    docs, per = [], []
    for i, (doc_id, results, report_date) in enumerate(specs):
        ch = raw(results)
        ch.report.report_date = report_date
        rs, _, meta = normalize_document(doc_id, [ch], cat)
        docs.append(Document(id=doc_id, filename=f"{doc_id}.pdf", sha256=doc_id, pages=1, media_type="application/pdf",
                             uploaded_at=f"2026-01-0{i + 1}T00:00:00+00:00", collected_date=meta["collected_date"],
                             report_date=meta["report_date"]))
        per.append(rs)
    return docs, per


def test_rescan_of_an_existing_report_is_marked_duplicate():
    docs, per = _docs(("orig", PANEL, "2025-11-03"), ("photo", PANEL[:3], "2025-11-03"))
    out = merge(docs, per, [[], []], cat)
    by = {d["id"]: d for d in out["documents"]}
    assert by["photo"].get("duplicate_of") == "orig" and not by["orig"].get("duplicate_of")
    assert not out["suggestions"]


def test_corrected_version_is_suggested_then_applied_by_the_user():
    fixed = [("Potassium", "4.9", "mmol/L", "potassium") if r[3] == "potassium" else r for r in PANEL]
    docs, per = _docs(("old", PANEL, "2025-11-03"), ("new", fixed, "2025-11-10"))
    out = merge(docs, per, [[], []], cat)
    (s,) = out["suggestions"]
    assert (s["newer"], s["older"], s["n_changed"]) == ("new", "old", 1)
    assert s["changed"][0]["test_id"] == "potassium"
    # the differing value waits for the decision instead of also showing up as a conflict
    assert all("different values reported for the same day" not in r.get("issues", []) for r in out["results"])

    # "keep both": the question disappears
    docs, per = _docs(("old", PANEL, "2025-11-03"), ("new", fixed, "2025-11-10"))
    assert not merge(docs, per, [[], []], cat, {"documents": {"new": {"action": "keep_both", "with": "old"}}})["suggestions"]

    # "use the newer": the old report's values are set aside, one potassium value remains
    docs, per = _docs(("old", PANEL, "2025-11-03"), ("new", fixed, "2025-11-10"))
    out = merge(docs, per, [[], []], cat, {"documents": {"old": {"action": "supersede", "by": "new"}}})
    k = [r for r in out["results"] if r["test_id"] == "potassium" and r["status"] != "superseded"]
    assert len(k) == 1 and k[0]["value_raw"] == "4.9"
    assert next(d for d in out["documents"] if d["id"] == "old")["superseded_by"] == "new"
    assert not out["suggestions"]
