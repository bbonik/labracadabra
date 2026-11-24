from pmt import catalog as C
from pmt.merge import merge
from pmt.normalize import normalize_document, parse_date, parse_number
from pmt.schema import Document, RawExtraction

cat = C.load()


def raw(results, pages, collected="2025-11-01"):
    return RawExtraction.model_validate(
        {"pages": pages, "report": {"collected_date": collected, "lab_name": "Lab", "patient_sex": "M"},
         "results": results, "findings": []}
    )


def r(page, name, value, unit, **kw):
    d = {"page": page, "raw_name": name, "value": value, "unit": unit, "source_text": f"{name} {value}"}
    d.update(kw)
    return d


def test_parse_helpers():
    assert parse_number("<1.7") == (1.7, "<")
    assert parse_number("4,7") == (4.7, None)
    assert parse_number("1,000") == (1000.0, None)
    assert parse_number("Non-reactive") == (None, None)
    assert parse_date("14/07/25") == "2025-07-14"
    assert parse_date("2024-11-11") == "2024-11-11"


def test_summary_and_lab_page_dedup_and_history():
    ch = raw(
        [
            r(10, "Direct LDL", "100", "mg/dL", catalog_id="ldl"),  # summary page
            r(20, "Direct LDL Cholesterol", "100", "mg/dL", catalog_id="ldl", ref_high=100),  # lab page
            r(20, "Direct LDL Cholesterol", "114", "mg/dL", catalog_id="ldl", date="2024-11-11", is_historical=True),
            r(20, "FSH", "13.10", "IU/L", catalog_id="fsh", ref_low=1, ref_high=12, lab_flag="H"),
            r(25, "Protein", "Trace", None, section="URINALYSIS", ref_text="Negative"),
        ],
        [{"page": 10, "type": "summary"}, {"page": 20, "type": "lab_results"}, {"page": 25, "type": "lab_results"}],
    )
    results, findings, meta = normalize_document("d1", [ch], cat)
    doc = Document(id="d1", filename="x.pdf", sha256="x", pages=30, media_type="application/pdf", uploaded_at="now")
    out = merge([doc], [results], [findings], cat)
    ldl = [x for x in out["results"] if x["test_id"] == "ldl"]
    assert len(ldl) == 2
    cur = next(x for x in ldl if x["date"] == "2025-11-01")
    assert cur["page"] == 20 and len(cur["also_in"]) == 1  # lab page preferred, summary noted
    assert abs(cur["value"] - 2.586) < 0.01 and cur["unit"] == "mmol/L"
    fsh = next(x for x in out["results"] if x["test_id"] == "fsh")
    assert fsh["flag"] == "H"
    prot = next(x for x in out["results"] if x["test_id"] == "urine_protein")
    assert prot["flag"] == "A" and prot["value"] == 0.5


def test_unmapped_and_implausible_are_flagged():
    ch = raw([r(1, "Mystery Marker", "3", "mg/L"), r(1, "Potassium", "45", "mmol/L", catalog_id="potassium")],
             [{"page": 1, "type": "lab_results"}])
    results, _, _ = normalize_document("d2", [ch], cat)
    by = {x.raw_name: x for x in results}
    assert by["Mystery Marker"].status == "flagged" and "not in catalog" in by["Mystery Marker"].issues
    assert by["Potassium"].status == "flagged" and any("implausible" in i for i in by["Potassium"].issues)


def test_user_alias_and_correction():
    ch = raw([r(1, "Mystery Marker", "3", "mg/L")], [{"page": 1, "type": "lab_results"}])
    results, _, _ = normalize_document("d3", [ch], cat, aliases={"mysterymarker": "crp"})
    assert results[0].test_id == "crp" and results[0].status == "ok"
    doc = Document(id="d3", filename="x.pdf", sha256="x", pages=1, media_type="application/pdf", uploaded_at="now")
    out = merge([doc], [results], [[]], cat, {"results": {results[0].id: {"action": "edit", "value": 4}}})
    assert out["results"][0]["value"] == 4 and out["results"][0]["status"] == "user_corrected"


def test_interpretation_word_before_number():
    assert parse_number("REACTIVE > 1000") == (1000.0, ">")
    assert parse_number("Positive 45.2") == (45.2, None)
    assert parse_number("Non-Reactive") == (None, None)


def test_missing_unit_inferred_from_value_and_range():
    ch = raw([r(1, "Haematocrit (PCV)", "0.40", None, catalog_id="hematocrit", ref_low=0.40, ref_high=0.54)],
             [{"page": 1, "type": "lab_results"}])
    (res,), _, _ = normalize_document("d4", [ch], cat)
    assert res.value == 40 and res.unit == "%" and (res.ref_low, res.ref_high) == (40, 54)
    assert res.status == "ok"


def test_lipid_risk_tiers_are_not_used_as_reference_range():
    # some labs print the "Desirable" tier as the range: HDL (40 - 59), TG (150 - 199)
    ch = raw([r(1, "HDL Cholesterol", "69", "mg/dL", catalog_id="hdl", ref_low=40, ref_high=59, ref_text="(40 - 59)"),
              r(1, "Triglycerides", "42", "mg/dL", catalog_id="triglycerides", ref_low=150, ref_high=199),
              r(1, "LDL Chol (Direct)", "130", "mg/dL", catalog_id="ldl", ref_low=100, ref_high=129)],
             [{"page": 1, "type": "lab_results"}])
    res, _, _ = normalize_document("d5", [ch], cat)
    by = {x.test_id: x for x in res}
    assert by["hdl"].flag is None and by["hdl"].ref_source == "catalog" and by["hdl"].ref_text == "(40 - 59)"
    assert by["triglycerides"].flag is None
    assert by["ldl"].flag == "H"  # 130 mg/dL = borderline high


def test_placeholder_rows_skipped_and_laterality_split():
    ch = raw([r(1, "Others", "Nil", None, section="URINE FEME"),
              r(2, "Visual acuity (Left)", "6/9", None, catalog_id="visual_acuity"),
              r(2, "Visual acuity (Right)", "6/6", None, catalog_id="visual_acuity")],
             [{"page": 1, "type": "lab_results"}, {"page": 2, "type": "summary"}])
    res, _, _ = normalize_document("d6", [ch], cat)
    assert sorted(x.test_id for x in res) == ["visual_acuity_l", "visual_acuity_r"]
    assert all(x.status == "ok" for x in res)


def test_durations_parse_to_minutes():
    from pmt.normalize import parse_duration_min
    assert abs(parse_duration_min("7:25") - 7.4167) < 1e-3
    assert abs(parse_duration_min("9:32 min:s") - 9.5333) < 1e-3
    assert abs(parse_duration_min("07 min 25 sec") - 7.4167) < 1e-3
    assert parse_duration_min("Normal") is None


def test_stress_test_page_bp_and_duration_merge():
    ch = raw([r(5, "Diastolic", "59", "mmHg", catalog_id="bp_diastolic"),
              r(34, "Resting blood pressure (diastolic)", "69", "mmHg", catalog_id="bp_diastolic"),
              r(29, "Exercise time", "7:25", "min", catalog_id="treadmill_duration"),
              r(50, "Exercise duration", "07 min 25 sec", None, catalog_id="treadmill_duration"),
              r(30, "ECG interpretation", "Normal sinus rhythm", None, catalog_id="ecg_interpretation"),
              r(34, "Resting ECG", "normal", None, catalog_id="ecg_interpretation")],
             [{"page": 5, "type": "summary"}, {"page": 29, "type": "ecg"}, {"page": 30, "type": "ecg"},
              {"page": 34, "type": "ecg"}, {"page": 50, "type": "ecg"}])
    results, _, _ = normalize_document("d7", [ch], cat)
    doc = Document(id="d7", filename="x.pdf", sha256="x", pages=50, media_type="application/pdf", uploaded_at="now")
    out = merge([doc], [results], [[]], cat)["results"]
    ids = sorted(x["test_id"] for x in out)
    assert ids == ["bp_diastolic", "ecg_interpretation", "ecg_interpretation", "treadmill_duration", "treadmill_rest_dbp"]
    assert all(x["status"] == "ok" for x in out), [(x["test_id"], x["issues"]) for x in out]


def test_omega3_panel_and_copper_are_recognised():
    ch = raw([r(1, "Omega-3 Index", "7.9", "%", ref_low=3.0, ref_high=14.1),
              r(1, "Omega-6:Omega-3", "5.6:1", None),
              r(1, "AA:EPA", "6.3:1", None),
              r(1, "Trans Fat Index", "0.52", "%"),
              r(2, "Copper Serum", "16.2", "umol/L", ref_low=11.0, ref_high=25.0)],
             [{"page": 1, "type": "lab_results"}, {"page": 2, "type": "lab_results"}])
    results, _, _ = normalize_document("d9", [ch], cat)
    by = {x.raw_name: x for x in results}
    assert {n: (x.test_id, x.value, x.status) for n, x in by.items()} == {
        "Omega-3 Index": ("omega3_index", 7.9, "ok"),
        "Omega-6:Omega-3": ("omega6_omega3_ratio", 5.6, "ok"),
        "AA:EPA": ("aa_epa_ratio", 6.3, "ok"),
        "Trans Fat Index": ("trans_fat_index", 0.52, "ok"),
        "Copper Serum": ("copper", 16.2, "ok"),
    }
    assert parse_number("6,3:1") == (6.3, None) and parse_number("12:30") == (None, None)


def test_free_testosterone_in_percent_is_its_own_test():
    ch = raw([r(2, "Free Testosterone", "0.29", "nmol/L", section="Calculated"),
              r(2, "Free Testosterone", "1.55", "%", section="Calculated"),
              r(2, "Bioavailable Testosterone", "41.2", "%", section="Calculated")],
             [{"page": 2, "type": "lab_results"}])
    results, findings, _ = normalize_document("d10", [ch], cat)
    assert sorted((x.test_id, x.status) for x in results) == [
        ("testosterone_bioavailable_pct", "ok"), ("testosterone_free", "ok"), ("testosterone_free_pct", "ok")]
    doc = Document(id="d10", filename="x.pdf", sha256="x", pages=2, media_type="application/pdf", uploaded_at="now")
    out = merge([doc], [results], [findings], cat)
    assert not [x for x in out["results"] if x["status"] == "flagged"]


def test_bone_density_sites_echo_and_section_specific_names():
    ch = raw([r(1, "BMD (bone mineral density)", "0.874", "g/cm²", section="LEFT HIP (NECK)"),
              r(1, "T score", "0.6", None, section="LEFT HIP (NECK)", catalog_id="bmd_tscore_hip"),
              r(1, "Z score", "1.2", None, section="LUMBAR VERTEBRAE (L1 to L4)"),
              r(1, "Total BMD", "0.986", "g/cm²", section="DXA Results Summary"),
              r(2, "LVIDd", "4.5", "cm", catalog_id="echo_lvidd"),
              r(2, "TAPSE", "2.1", "cm"),
              r(2, "SEP E'", "0.10", "m/s"),
              r(2, "LAVI", "27", "ml/m2"),
              r(3, "Interpretation", "NORMAL", None, section="FVC REPORT", catalog_id="ldl")],
             [{"page": 1, "type": "imaging"}, {"page": 2, "type": "imaging"}, {"page": 3, "type": "other"}])
    results, _, _ = normalize_document("d11", [ch], cat)
    got = {(x.raw_name, x.section): (x.test_id, x.value if x.kind != "text" else x.value_text, x.status) for x in results}
    assert got == {
        ("BMD (bone mineral density)", "LEFT HIP (NECK)"): ("bmd_neck", 0.874, "ok"),
        ("T score", "LEFT HIP (NECK)"): ("bmd_tscore_neck", 0.6, "ok"),  # section beats the model's suggestion
        ("Z score", "LUMBAR VERTEBRAE (L1 to L4)"): ("bmd_zscore_spine", 1.2, "ok"),
        ("Total BMD", "DXA Results Summary"): ("bmd_total_hip", 0.986, "ok"),
        ("LVIDd", None): ("echo_lvidd", 45.0, "ok"),  # cm → mm
        ("TAPSE", None): ("echo_tapse", 21.0, "ok"),
        ("SEP E'", None): ("echo_eprime_septal", 0.1, "ok"),
        ("LAVI", None): ("echo_lavi", 27.0, "ok"),
        ("Interpretation", "FVC REPORT"): ("spirometry_interpretation", "NORMAL", "ok"),  # was filed under LDL
    }


def test_exact_name_beats_model_suggestion_and_lab_wording_is_accepted():
    ch = raw([r(1, "Neck T-score", "0.6", None, catalog_id="bmd_tscore_hip"),
              r(2, "Ερυθρα αιμοσφαιρια", "0-1", None, section="ΜΙΚΡΟΣΚΟΠΙΚΗ ΕΞΕΤΑΣΗ ΟΥΡΩΝ", catalog_id="urine_rbc"),
              r(2, "Hepatitis Bs Antibody", "Non-Reactive", "mIU/mL", catalog_id="anti_hbs"),
              r(2, "Anti-ds DNA", "Pending", None, catalog_id="anti_dsdna"),
              r(2, "Ειδικό Βάρος", "1015", None, catalog_id="urine_sg"),
              r(2, "WBC ΑΡΙΘΜΟΣ ΛΕΥΚΩΝ", "6.2", "1000/mm**3", catalog_id="wbc"),
              r(2, "MCV Μέσος Ογκος Ερυθρών", "88.1", "µm**3", catalog_id="mcv"),
              r(2, "Lipoprotein (a)", "9.8", "mg/dL", catalog_id="lpa")],
             [{"page": 1, "type": "imaging"}, {"page": 2, "type": "lab_results"}])
    results, _, _ = normalize_document("d12", [ch], cat)
    got = {x.raw_name: (x.test_id, x.value, x.status) for x in results}
    assert got["Neck T-score"] == ("bmd_tscore_neck", 0.6, "ok")
    assert got["Ερυθρα αιμοσφαιρια"] == ("urine_rbc", 1.0, "ok")  # "0-1" per field → at most 1, still urine
    assert got["Hepatitis Bs Antibody"] == ("anti_hbs", None, "ok")  # the lab's wording, kept as text
    assert got["Anti-ds DNA"][2] == "ignored"  # nothing to record yet
    assert got["Ειδικό Βάρος"] == ("urine_sg", 1.015, "ok")
    assert got["WBC ΑΡΙΘΜΟΣ ΛΕΥΚΩΝ"] == ("wbc", 6.2, "ok")
    assert got["MCV Μέσος Ογκος Ερυθρών"] == ("mcv", 88.1, "ok")
    assert got["Lipoprotein (a)"] == ("lpa_mass", 9.8, "ok")
