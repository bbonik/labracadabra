"""Generate a synthetic demo profile (fixtures/demo/results.json) — NO real patient data.

Run:  cd extractor && .venv/bin/python ../fixtures/make_demo.py
The series contain deliberate patterns so every dashboard feature has something to show:
rising PSA, LDL step-down, ferritin spike, repeated low haemoglobin, slowly rising HbA1c, seasonal vitamin D.
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "extractor"))
from pmt import catalog as C  # noqa: E402
from pmt.units import to_canonical  # noqa: E402

random.seed(7)
cat = C.load()
OUT = Path(__file__).resolve().parent / "demo"

DATES = [date(2021, 3, 12) + timedelta(days=int(i * 182.5 + random.randint(-20, 20))) for i in range(11)]
LABS = ["Northside Diagnostics", "Harbour Medical Lab", "Ιατρικά Εργαστήρια Αθηνών"]


def t_years(d: date) -> float:
    return (d - DATES[0]).days / 365.25


def noise(sd: float) -> float:
    return random.gauss(0, sd)


# test_id → function(date index, date) → canonical value
SERIES = {
    "psa_total": lambda i, d: 0.62 * math.exp(0.22 * t_years(d)) + noise(0.04),
    "ldl": lambda i, d: (3.95 if d < date(2023, 6, 1) else 2.55) + noise(0.12),
    "cholesterol_total": lambda i, d: (5.9 if d < date(2023, 6, 1) else 4.6) + noise(0.15),
    "hdl": lambda i, d: 1.35 + noise(0.07),
    "triglycerides": lambda i, d: 1.2 + noise(0.25),
    "apob": lambda i, d: (1.12 if d < date(2023, 6, 1) else 0.78) + noise(0.04),
    "hba1c": lambda i, d: 5.25 + 0.09 * t_years(d) + noise(0.06),
    "glucose_fasting": lambda i, d: 5.0 + 0.08 * t_years(d) + noise(0.2),
    "ferritin": lambda i, d: 140 + noise(12) + (210 if i == 6 else 0),
    "iron": lambda i, d: 19 + noise(3),
    "hemoglobin": lambda i, d: (128 if i in (7, 8) else 146) + noise(3),
    "rbc": lambda i, d: 4.95 + noise(0.12),
    "wbc": lambda i, d: (3.6 if i == 4 else 5.6) + noise(0.4),
    "platelets": lambda i, d: 245 + noise(20),
    "mcv": lambda i, d: 88 + noise(1.5),
    "alt": lambda i, d: 24 + noise(6) + (18 if i in (3, 4) else 0),
    "ast": lambda i, d: 22 + noise(4),
    "ggt": lambda i, d: 26 + noise(5),
    "albumin": lambda i, d: 46 + noise(1.5),
    "bilirubin_total": lambda i, d: 14 + noise(3),
    "creatinine": lambda i, d: 82 + noise(5),
    "egfr": lambda i, d: 98 - 0.8 * t_years(d) + noise(3),
    "urea": lambda i, d: 5.1 + noise(0.6),
    "sodium": lambda i, d: 140 + noise(1.5),
    "potassium": lambda i, d: 4.3 + noise(0.2),
    "uric_acid": lambda i, d: 360 + noise(30),
    "tsh": lambda i, d: 1.6 + noise(0.35),
    "ft4": lambda i, d: 14.2 + noise(1.0),
    "testosterone_total": lambda i, d: 21 - 0.6 * t_years(d) + noise(1.8),
    "shbg": lambda i, d: 38 + 2.2 * t_years(d) + noise(2.5),
    "estradiol": lambda i, d: (205 if i in (8, 10) else 120) + noise(12),
    "vitamin_d": lambda i, d: 80 + 30 * math.cos((d.timetuple().tm_yday - 220) / 365.25 * 2 * math.pi) + noise(6),
    "vitamin_b12": lambda i, d: 420 + noise(40),
    "hscrp": lambda i, d: max(0.2, 1.1 + noise(0.4) + (4.2 if i == 5 else 0)),
    "weight": lambda i, d: 84 - 0.5 * t_years(d) + noise(0.8),
    "bmi": lambda i, d: (84 - 0.5 * t_years(d)) / 1.84**2 + noise(0.2),
    "waist": lambda i, d: 98 - 0.7 * t_years(d) + noise(1),
    "bp_systolic": lambda i, d: 124 + noise(6),
    "bp_diastolic": lambda i, d: 78 + noise(4),
    "ecg_qtc": lambda i, d: 412 + noise(8),
    "ecg_pr": lambda i, d: 168 + noise(6),
}
# Which tests each visit measures (screening visits have everything, interim visits a subset)
INTERIM = {"psa_total", "ldl", "cholesterol_total", "hdl", "triglycerides", "hba1c", "testosterone_total", "shbg",
           "estradiol", "ferritin", "hemoglobin", "vitamin_d", "alt"}
US_UNITS = {"cholesterol_total": "mg/dL", "ldl": "mg/dL", "hdl": "mg/dL", "triglycerides": "mg/dL",
            "glucose_fasting": "mg/dL", "creatinine": "mg/dL", "testosterone_total": "ng/dL",
            "vitamin_d": "ng/mL", "hemoglobin": "g/dL", "estradiol": "pg/mL"}


def rid(*p) -> str:
    return hashlib.sha1("|".join(map(str, p)).encode()).hexdigest()[:12]


def fmt(v: float, decimals: int | None) -> str:
    d = 2 if decimals is None else decimals
    return f"{v:.{d}f}"


documents, results, findings = [], [], []
for i, d in enumerate(DATES):
    screening = i % 2 == 0
    doc_id = rid("doc", d)
    lab = LABS[0] if i < 5 else LABS[1] if i < 9 else LABS[2]
    use_us = lab == LABS[0]
    tests = [t for t in SERIES if screening or t in INTERIM]
    pages = 24 if screening else 2
    page_types = {"1": "cover"} if screening else {}
    for p in range(2, pages + 1):
        page_types[str(p)] = "summary" if screening and p < 8 else "imaging" if screening and p > 21 else "lab_results"
    page_types.setdefault("1", "lab_results")
    documents.append({
        "id": doc_id, "filename": f"{d.isoformat()} {'health screening' if screening else 'blood test'}.pdf",
        "sha256": hashlib.sha256(doc_id.encode()).hexdigest(), "pages": pages, "media_type": "application/pdf",
        "uploaded_at": f"{d.isoformat()}T12:00:00+00:00", "report_date": (d + timedelta(days=3)).isoformat(),
        "collected_date": d.isoformat(), "labs": [lab], "page_types": page_types, "status": "done",
        "model": "claude-opus-5-5", "cost_usd": round(0.04 + pages * 0.012, 3), "demo": True,
    })
    for n, test_id in enumerate(tests):
        t = cat.tests[test_id]
        v = SERIES[test_id](i, d)
        unit_raw = US_UNITS.get(test_id) if use_us else None
        unit_raw = unit_raw or t["unit"]
        k = to_canonical(1.0, unit_raw, t)
        raw_dec = 0 if unit_raw == "mg/dL" else t.get("decimals")
        value_raw = fmt(v / k, raw_dec)
        v = round(float(value_raw) * k, 6)
        ref = t.get("ref_m") or t.get("ref") or {}
        lo, hi = ref.get("low"), ref.get("high")
        flag = "L" if lo is not None and v < lo else "H" if hi is not None and v > hi else None
        page = 3 + n // 14 if screening else 1 + n // 14
        if screening and t["panel"].startswith("vitals"):
            page = 3
        if t["panel"].startswith("cardio"):
            page = 20
        page_type = page_types.get(str(page), "lab_results")
        results.append({
            "id": rid(doc_id, test_id), "test_id": test_id, "raw_name": t["name"], "date": d.isoformat(),
            "kind": "numeric", "value": v, "unit": t["unit"], "value_raw": value_raw, "unit_raw": unit_raw,
            "ref_low": lo, "ref_high": hi, "ref_source": "lab", "flag": flag, "doc_id": doc_id, "page": page,
            "page_type": page_type, "source_text": f"{t['name']}  {value_raw} {unit_raw}", "lab": lab,
            "is_historical": False, "confidence": round(random.uniform(0.9, 1.0), 2), "status": "ok",
            "issues": [], "also_in": [],
        })
    if screening:
        results.append({
            "id": rid(doc_id, "urine_protein"), "test_id": "urine_protein", "raw_name": "Protein",
            "date": d.isoformat(), "kind": "qualitative", "value": 0.5 if i == 6 else 0.0,
            "value_text": "Trace" if i == 6 else "Negative", "value_raw": "Trace" if i == 6 else "Negative",
            "flag": "A" if i == 6 else None, "ref_text": "Negative", "doc_id": doc_id, "page": 12,
            "page_type": "lab_results", "source_text": "Protein  Negative", "lab": lab, "section": "URINALYSIS",
            "confidence": 0.97, "status": "ok", "issues": [], "also_in": [],
        })
        findings.append({
            "id": rid(doc_id, "us"), "doc_id": doc_id, "page": 22, "date": d.isoformat(), "modality": "Ultrasound",
            "body_part": "Abdomen", "title": "Ultrasound abdomen",
            "impression": "Mildly increased hepatic echogenicity, suggestive of mild fatty infiltration. No focal lesion."
            if i in (2, 4) else "No significant sonographic abnormality detected.",
            "is_abnormal": i in (2, 4),
        })
        findings.append({
            "id": rid(doc_id, "cxr"), "doc_id": doc_id, "page": 23, "date": d.isoformat(), "modality": "X-ray",
            "body_part": "Chest", "title": "Chest X-ray (PA)", "impression": "Heart size normal. Lungs clear.",
            "is_abnormal": False,
        })

# Inbox examples
last = documents[-1]
results.append({
    "id": rid("unmapped"), "test_id": None, "raw_name": "Lp-PLA2 Activity", "date": last["collected_date"],
    "kind": "numeric", "value": 162, "unit": "nmol/min/mL", "value_raw": "162", "unit_raw": "nmol/min/mL",
    "doc_id": last["id"], "page": 2, "page_type": "lab_results", "source_text": "Lp-PLA2 Activity 162",
    "lab": LABS[2], "confidence": 0.95, "status": "flagged", "issues": ["not in catalog"], "also_in": [],
})
lowconf = next(r for r in results if r["test_id"] == "potassium" and r["date"] == last["collected_date"]) \
    if any(r["test_id"] == "potassium" and r["date"] == last["collected_date"] for r in results) else None
if lowconf:
    lowconf.update(confidence=0.62, status="flagged", issues=["low confidence (0.62)"])

OUT.mkdir(parents=True, exist_ok=True)
(OUT / "results.json").write_text(json.dumps({
    "schema": 1, "updated_at": "2026-06-01T09:00:00+00:00", "demo": True,
    "documents": documents, "results": results, "findings": findings,
}, ensure_ascii=False, indent=1))
(OUT / "profile.json").write_text(json.dumps({"name": "Alex Demo", "sex": "M", "birth_year": 1977}))
print(f"wrote {OUT/'results.json'}: {len(documents)} docs, {len(results)} results, {len(findings)} findings")
