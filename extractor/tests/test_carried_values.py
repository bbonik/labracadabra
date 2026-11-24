"""Reports that repeat earlier results for comparison: the copies must not end up as a second value on the new date."""
from pmt import catalog as C
from pmt.merge import SUMMARY_COPY, merge
from pmt.normalize import normalize_document
from pmt.schema import Document, RawExtraction

cat = C.load()
LAB = {"type": "lab_results"}
SUMMARY = {"type": "summary"}


def report(doc_id, collected, rows, pages):
    """rows: (page, value) LDL values in mg/dL; pages: {page: page dict}"""
    raw = RawExtraction.model_validate({
        "pages": [{"page": p, **t} for p, t in pages.items()],
        "report": {"collected_date": collected, "lab_name": "Lab", "patient_sex": "F"},
        "results": [{"page": p, "raw_name": "LDL Cholesterol", "value": v, "unit": "mg/dL", "catalog_id": "ldl",
                     "source_text": f"LDL {v}"} for p, v in rows],
        "findings": [],
    })
    results, findings, _ = normalize_document(doc_id, [raw], cat)
    doc = Document(id=doc_id, filename=f"{doc_id}.pdf", sha256=doc_id, pages=max(pages), media_type="application/pdf",
                   uploaded_at=collected, collected_date=collected)
    return doc, results, findings


def run(*reports, corrections=None):
    docs, res, fnd = zip(*reports)
    out = merge(list(docs), list(res), list(fnd), cat, corrections)
    return [x for x in out["results"] if x["test_id"] == "ldl" and x["status"] not in ("duplicate", "ignored")], out


def mgdl(x):
    return round(x["value"] / 0.02586)


def test_previous_year_repeated_on_summary_page_moves_back_to_its_date():
    a = report("a", "2020-03-15", [(7, "118")], {7: LAB})
    b = report("b", "2021-11-08", [(9, "141"), (6, "118")], {9: LAB, 6: SUMMARY})
    ldl, _ = run(a, b)
    by_date = {x["date"]: x for x in ldl}
    assert sorted(by_date) == ["2020-03-15", "2021-11-08"]
    new = by_date["2021-11-08"]
    assert mgdl(new) == 141 and new["status"] == "ok" and not new.get("issues")
    old = by_date["2020-03-15"]
    assert [(s["doc_id"], s.get("date_on_report")) for s in old["also_in"]] == [("b", "2021-11-08")]


def test_two_earlier_years_repeated():
    y1 = report("y1", "2016-05-10", [(9, "112")], {9: LAB})
    y2 = report("y2", "2017-06-02", [(8, "121")], {8: LAB})
    y3 = report("y3", "2018-05-21", [(9, "109"), (6, "121"), (6, "112")], {9: LAB, 6: SUMMARY})
    ldl, _ = run(y1, y2, y3)
    assert [(x["date"], mgdl(x), x["status"]) for x in ldl] == [
        ("2016-05-10", 112, "ok"), ("2017-06-02", 121, "ok"), ("2018-05-21", 109, "ok")]


def test_same_value_two_years_running_is_not_touched():
    a = report("a", "2020-03-15", [(7, "118")], {7: LAB})
    b = report("b", "2021-11-08", [(7, "118")], {7: LAB})
    ldl, _ = run(a, b)
    assert [x["date"] for x in ldl] == ["2020-03-15", "2021-11-08"]


def test_two_labs_disagreeing_on_the_same_day_is_still_a_question():
    a = report("a", "2021-11-08", [(1, "141")], {1: LAB})
    b = report("b", "2021-11-08", [(1, "131")], {1: LAB})
    ldl, _ = run(a, b)
    assert len(ldl) == 2 and all(x["status"] == "flagged" for x in ldl)


def test_summary_copy_without_known_history_is_hidden_not_asked():
    b = report("b", "2021-11-08", [(9, "141"), (6, "118")], {9: LAB, 6: SUMMARY})
    ldl, out = run(b)
    assert [(mgdl(x), x["status"]) for x in ldl] == [(141, "ok")]
    hidden = [x for x in out["results"] if x["status"] == "duplicate"]
    assert len(hidden) == 1 and hidden[0]["issues"] == [SUMMARY_COPY]


def test_value_confirmed_by_the_user_stays_where_it_is():
    a = report("a", "2020-03-15", [(7, "118")], {7: LAB})
    b = report("b", "2021-11-08", [(9, "141"), (6, "118")], {9: LAB, 6: SUMMARY})
    copy_id = next(r.id for r in b[1] if r.page == 6)
    ldl, _ = run(a, b, corrections={"results": {copy_id: {"action": "confirm"}}})
    assert sorted((x["date"], mgdl(x)) for x in ldl) == [("2020-03-15", 118), ("2021-11-08", 118), ("2021-11-08", 141)]


def test_too_old_earlier_value_is_not_matched():
    a = report("a", "2014-02-03", [(7, "118")], {7: LAB})
    b = report("b", "2021-11-08", [(1, "141")], {1: LAB})
    c = report("c", "2021-11-08", [(1, "118")], {1: LAB})
    ldl, _ = run(a, b, c)
    assert sum(x["date"] == "2021-11-08" for x in ldl) == 2  # 7 years back: not a comparison column, still a question


def test_earlier_value_without_a_printed_date_is_dropped_not_given_the_report_date():
    raw = RawExtraction.model_validate({
        "pages": [{"page": 1, "type": "lab_results"}],
        "report": {"collected_date": "2021-11-08", "lab_name": "Lab"},
        "results": [{"page": 1, "raw_name": "LDL", "value": "141", "unit": "mg/dL", "catalog_id": "ldl"},
                    {"page": 1, "raw_name": "LDL", "value": "118", "unit": "mg/dL", "catalog_id": "ldl",
                     "is_historical": True}],
        "findings": [],
    })
    results, _, _ = normalize_document("d", [raw], cat)
    assert [(r.value_raw, r.date) for r in results if r.test_id == "ldl"] == [("141", "2021-11-08")]


def test_earlier_result_marked_historical_but_given_the_report_date():
    """What the model actually did on a real summary page: is_historical=true, date = the report's own date."""
    def hist_report(doc_id, collected, current, copies):
        raw = RawExtraction.model_validate({
            "pages": [{"page": 9, "type": "lab_results"}, {"page": 6, "type": "summary"}],
            "report": {"collected_date": collected, "lab_name": "Lab"},
            "results": [{"page": 9, "raw_name": "LDL", "value": current, "unit": "mg/dL", "catalog_id": "ldl"}] +
                       [{"page": 6, "raw_name": "LDL", "value": v, "unit": "mg/dL", "catalog_id": "ldl", "date": collected,
                         "is_historical": True, "confidence": 0.7} for v in copies],
            "findings": [],
        })
        results, findings, _ = normalize_document(doc_id, [raw], cat)
        return (Document(id=doc_id, filename=doc_id, sha256=doc_id, pages=9, media_type="application/pdf",
                         uploaded_at=collected, collected_date=collected), results, findings)
    y1 = report("y1", "2016-05-10", [(9, "112")], {9: LAB})
    y2 = report("y2", "2017-06-02", [(8, "121")], {8: LAB})
    y3 = hist_report("y3", "2018-05-21", "109", ["121", "112", "97"])
    ldl, out = run(y1, y2, y3)
    assert [(x["date"], mgdl(x), x["status"]) for x in ldl] == [
        ("2016-05-10", 112, "ok"), ("2017-06-02", 121, "ok"), ("2018-05-21", 109, "ok")]
    hidden = [x for x in out["results"] if x["status"] == "duplicate"]
    assert [x["value_raw"] for x in hidden] == ["97"]  # no earlier match: hidden, not asked
    assert not [x for x in out["results"] if x["status"] == "flagged"]


def test_summary_value_with_a_typo_is_hidden_even_when_the_lab_value_is_repeated_elsewhere():
    a = report("a", "2015-04-06", [(8, "86"), (2, "860")], {8: LAB, 2: SUMMARY})  # summary typo
    b = report("b", "2016-05-10", [(9, "93")], {9: LAB})
    # a later report repeating 2016's value correctly, as an earlier result with its date
    raw = RawExtraction.model_validate({
        "pages": [{"page": 9, "type": "lab_results"}], "report": {"collected_date": "2016-05-10"},
        "results": [{"page": 9, "raw_name": "LDL", "value": "86", "unit": "mg/dL", "catalog_id": "ldl",
                     "date": "2015-04-06", "is_historical": True}], "findings": []})
    res, f, _ = normalize_document("c", [raw], cat)
    c = (Document(id="c", filename="c", sha256="c", pages=9, media_type="application/pdf", uploaded_at="x",
                  collected_date="2016-05-10"), res, f)
    ldl, _ = run(a, b, c)
    assert [(x["date"], mgdl(x), x["status"]) for x in ldl] == [("2015-04-06", 86, "ok"), ("2016-05-10", 93, "ok")]


def test_blood_pressure_readings_at_different_moments_are_not_a_conflict():
    def bp(doc_id, page, ptype, v):
        raw = RawExtraction.model_validate({
            "pages": [{"page": page, "type": ptype}], "report": {"collected_date": "2023-09-04"},
            "results": [{"page": page, "raw_name": "Diastolic BP", "value": v, "unit": "mmHg", "catalog_id": "bp_diastolic"}],
            "findings": []})
        res, f, _ = normalize_document(doc_id, [raw], cat)
        return (Document(id=doc_id, filename=doc_id, sha256=doc_id, pages=page, media_type="application/pdf",
                         uploaded_at="x", collected_date="2023-09-04"), res, f)
    docs, res, fnd = zip(bp("a", 5, "summary", "71"), bp("b", 31, "imaging", "63"))
    out = merge(list(docs), list(res), list(fnd), cat)
    bps = [x for x in out["results"] if x["test_id"] == "bp_diastolic"]
    assert len(bps) == 2 and all(x["status"] == "ok" for x in bps)
