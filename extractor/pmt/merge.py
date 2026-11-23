"""Combine per-document results into one de-duplicated results.json, applying user corrections."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone

from .catalog import Catalog
from .schema import Document, Finding, Result

# when the same value is printed in several places, which source do we link to?
_PAGE_PRIORITY = {"lab_results": 0, "ecg": 1, "imaging": 1, "summary": 2}


def _same_value(a: Result, b: Result, decimals: int | None) -> bool:
    if a.value is not None and b.value is not None:
        if a.censor != b.censor:
            return False
        tol = max(abs(a.value), abs(b.value)) * 0.02
        if decimals is not None:
            tol = max(tol, 0.5 * 10 ** (-decimals))
        return abs(a.value - b.value) <= tol + 1e-12
    return (a.value_text or "").strip().lower() == (b.value_text or "").strip().lower()


def _rank(r: Result) -> tuple:
    return (r.status == "flagged", r.is_historical, _PAGE_PRIORITY.get(r.page_type or "", 3), -r.confidence)


def apply_corrections(results: list[Result], corrections: dict, catalog: Catalog) -> list[Result]:
    per = corrections.get("results", {})
    out = []
    for r in results:
        c = per.get(r.id)
        if not c:
            out.append(r)
            continue
        action = c.get("action")
        if action == "ignore":
            r.status = "ignored"
        elif action == "confirm":
            r.status = "user_corrected"
            r.issues = []
        elif action == "edit":
            from .units import to_canonical

            if c.get("test_id"):
                r.test_id = c["test_id"]
            test = catalog.get(r.test_id)
            if "value" in c and test:
                unit = c.get("unit") or test["unit"]
                r.value = to_canonical(float(c["value"]), unit, test)
                r.unit = test["unit"]
                r.censor = None
            if "date" in c:
                r.date = c["date"]
            r.status = "user_corrected"
            r.issues = []
            r.flag = None
            if r.value is not None and r.ref_high is not None and r.value > r.ref_high:
                r.flag = "H"
            elif r.value is not None and r.ref_low is not None and r.value < r.ref_low:
                r.flag = "L"
        out.append(r)
    return out


def _doc_decisions(corrections: dict) -> dict[str, dict]:
    return {k: v for k, v in (corrections.get("documents") or {}).items() if isinstance(v, dict)}


def _newer(a: Document, b: Document) -> tuple[Document, Document]:
    """(newer, older) by report date, then upload time."""
    ka, kb = (a.report_date or "", a.uploaded_at or ""), (b.report_date or "", b.uploaded_at or "")
    return (a, b) if ka >= kb else (b, a)


def merge(
    docs: list[Document],
    per_doc_results: list[list[Result]],
    per_doc_findings: list[list[Finding]],
    catalog: Catalog,
    corrections: dict | None = None,
) -> dict:
    corrections = corrections or {}
    decisions = _doc_decisions(corrections)
    superseded = {k: v.get("by") for k, v in decisions.items() if v.get("action") == "supersede" and v.get("by")}
    for d in docs:
        d.superseded_by = superseded.get(d.id)
    all_results = [r for rs in per_doc_results for r in rs]
    all_results = apply_corrections(all_results, corrections, catalog)

    groups: dict[tuple, list[Result]] = defaultdict(list)
    final: list[Result] = []
    for r in all_results:
        if r.doc_id in superseded:
            r.status = "superseded"  # the user chose a corrected version of this report
            final.append(r)
        elif r.status == "ignored" or not r.test_id or not r.date:
            final.append(r)
        else:
            groups[(r.test_id, r.date)].append(r)

    cluster_of: dict[str, list[Result]] = {}  # result id → its cluster (same test, day and value)
    for (test_id, _), rs in groups.items():
        decimals = (catalog.get(test_id) or {}).get("decimals")
        rs.sort(key=_rank)
        clusters: list[list[Result]] = []
        for r in rs:
            for cl in clusters:
                if _same_value(cl[0], r, decimals):
                    cl.append(r)
                    break
            else:
                clusters.append([r])
        for cl in clusters:
            for r in cl:
                cluster_of[r.id] = cl
            primary = cl[0]
            for dup in cl[1:]:
                primary.also_in.append({"doc_id": dup.doc_id, "page": dup.page, "value_raw": dup.value_raw,
                                        "unit_raw": dup.unit_raw, "result_id": dup.id})
                # a confident lab-page copy confirms a low-confidence summary copy
                if dup.status == "user_corrected":
                    primary.status = "user_corrected"
            # if the primary was flagged only for confidence but another source agrees, accept it
            if primary.status == "flagged" and len(cl) > 1 and all(i.startswith("low confidence") for i in primary.issues):
                primary.issues, primary.status = [], "ok"
            final.append(primary)
        # free-text results (ECG/stress-test conclusions…) are often worded differently on different pages: keep
        # them all without calling it a conflict. A pending "corrected version?" question also isn't a conflict yet.
        non_hist = [cl[0] for cl in clusters if not cl[0].is_historical and cl[0].kind != "text"]
        if len(non_hist) > 1:
            for p in non_hist:
                if p.status != "user_corrected":
                    p.issues.append("different values reported for the same day")
                    p.status = "flagged"

    _mark_duplicate_documents(docs, all_results, cluster_of, superseded)
    suggestions = _corrected_version_suggestions(docs, all_results, cluster_of, decisions, catalog)
    # the "corrected version?" question explains those differences: don't also list each one as a conflict
    pending = {(s["newer"], c["test_id"]) for s in suggestions for c in s["changed"]} | \
              {(s["older"], c["test_id"]) for s in suggestions for c in s["changed"]}
    conflict = "different values reported for the same day"
    for r in final:
        if (r.doc_id, r.test_id) in pending and conflict in r.issues:
            r.issues = [i for i in r.issues if i != conflict]
            r.status = "flagged" if r.issues else "ok"

    final.sort(key=lambda r: (r.date or "", r.test_id or "~", r.page))
    findings = sorted((f for fs in per_doc_findings for f in fs if f.doc_id not in superseded), key=lambda f: f.date or "")
    return {
        "schema": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "documents": [d.model_dump() for d in sorted(docs, key=lambda d: d.collected_date or d.report_date or "")],
        "results": [r.model_dump(exclude_none=True) for r in final],
        "findings": [f.model_dump(exclude_none=True) for f in findings],
        "suggestions": suggestions,
    }


def _own_results(results: list[Result], doc_id: str) -> list[Result]:
    """A document's own current values (mapped, dated, not historical columns, not ignored)."""
    return [r for r in results if r.doc_id == doc_id and r.test_id and r.date and not r.is_historical
            and r.status not in ("ignored", "superseded")]


def _mark_duplicate_documents(docs, results, cluster_of, superseded) -> None:
    """A document whose every own value is already reported, identically and as a current value, by ONE earlier
    document with the same collection date is a re-scan / photo / re-download of it: mark it duplicate_of."""
    by_time = sorted((d for d in docs if d.status == "done" and d.id not in superseded), key=lambda d: d.uploaded_at or "")
    seen: list[Document] = []
    for d in by_time:
        own = _own_results(results, d.id)
        if own:
            earlier = {e.id: e for e in seen if e.collected_date and e.collected_date == d.collected_date}
            for e_id in earlier:
                if all(any(m.doc_id == e_id and not m.is_historical for m in cluster_of.get(r.id, [])) for r in own):
                    d.duplicate_of = e_id
                    break
        if not d.duplicate_of:
            seen.append(d)


def _corrected_version_suggestions(docs, results, cluster_of, decisions, catalog) -> list[dict]:
    """Two reports with the same collection date that share most of their tests but disagree on some values look
    like an original and its corrected re-issue. The user decides which one to keep (never automatic)."""
    cands = [d for d in docs if d.status == "done" and not d.duplicate_of and not d.superseded_by and d.collected_date]
    out = []
    for i, a in enumerate(cands):
        for b in cands[i + 1:]:
            if a.collected_date != b.collected_date:
                continue
            da, db = decisions.get(a.id, {}), decisions.get(b.id, {})
            if da.get("with") == b.id or db.get("with") == a.id:  # "keep both" already chosen for this pair
                continue
            ra = {r.test_id: r for r in _own_results(results, a.id)}
            rb = {r.test_id: r for r in _own_results(results, b.id)}
            common = set(ra) & set(rb)
            if len(common) < 5 or len(common) < 0.6 * min(len(ra), len(rb)):
                continue
            changed = sorted(t for t in common if cluster_of.get(ra[t].id) is not cluster_of.get(rb[t].id))
            if not changed:
                continue  # they agree everywhere: values already merge, nothing to decide
            newer, older = _newer(a, b)
            rn, ro = (ra, rb) if newer is a else (rb, ra)
            out.append({
                "kind": "corrected_version",
                "newer": newer.id, "older": older.id,
                "newer_filename": newer.filename, "older_filename": older.filename,
                "collected_date": a.collected_date,
                "common": len(common), "only_newer": len(set(rn) - set(ro)), "only_older": len(set(ro) - set(rn)),
                "changed": [{"test_id": t, "name": (catalog.get(t) or {}).get("name", t),
                             "newer": rn[t].value_raw, "older": ro[t].value_raw,
                             "unit": rn[t].unit_raw or ro[t].unit_raw} for t in changed][:25],
                "n_changed": len(changed),
            })
    return out
