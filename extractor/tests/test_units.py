import pytest

from pmt import catalog as C
from pmt.units import UnitError, algebra_factor, canon_unit, to_canonical

cat = C.load()
T = cat.tests


@pytest.mark.parametrize(
    "test_id,value,unit,expected,tol",
    [
        ("cholesterol_total", 200, "mg/dL", 5.17, 0.01),
        ("ldl", 100, "mg/dl", 2.59, 0.01),
        ("triglycerides", 150, "mg/dL", 1.69, 0.01),
        ("glucose_fasting", 90, "mg/dL", 5.0, 0.01),
        ("creatinine", 1.0, "mg/dL", 88.4, 0.1),
        ("uric_acid", 0.32, "mmol/L", 320, 0.01),
        ("uric_acid", 5.0, "mg/dL", 297.4, 0.5),
        ("testosterone_total", 600, "ng/dL", 20.8, 0.05),
        ("estradiol", 30, "pg/mL", 110.1, 0.2),
        ("vitamin_d", 55.7, "ng/mL", 139.0, 0.2),
        ("vitamin_b12", 400, "pg/mL", 295.1, 0.5),
        ("ft4", 1.2, "ng/dL", 15.4, 0.1),
        ("hemoglobin", 13.6, "g/dL", 136, 0.01),
        ("hemoglobin", 136, "g/L", 136, 0),
        ("psa_total", 0.21, "ng/mL", 0.21, 1e-9),
        ("psa_total", 0.21, "µg/L", 0.21, 1e-9),
        ("prolactin", 7.6, "ug/L", 161.1, 0.1),
        ("dht", 500, "pg/mL", 1.72, 0.01),
        ("iron", 100, "µg/dL", 17.9, 0.05),
        ("calcium", 9.5, "mg/dL", 2.37, 0.01),
        ("magnesium", 2.0, "mg/dL", 0.82, 0.01),
        ("sodium", 140, "mEq/L", 140, 0),
        ("hba1c", 48, "mmol/mol", 6.54, 0.02),
        ("tsh", 1.41, "µIU/mL", 1.41, 0),
        ("alt", 0.5, "µkat/L", 30, 1e-9),
        ("wbc", 4.1, "x 10^9/L", 4.1, 0),
        ("wbc", 4.1, "10^3/µL", 4.1, 0),
        ("weight", 180, "lbs", 81.6, 0.1),
        ("urine_acr", 30, "mg/g", 3.39, 0.01),
        ("apob", 74, "mg/dL", 0.74, 1e-9),
        ("bun", 14, "mg/dL", 5.0, 0.01),
    ],
)
def test_to_canonical(test_id, value, unit, expected, tol):
    assert to_canonical(value, unit, T[test_id]) == pytest.approx(expected, abs=tol)


def test_unconvertible_raises():
    with pytest.raises(UnitError):
        to_canonical(30, "mg/dL", T["lpa"])


def test_canon_unit_spellings():
    assert canon_unit("µmol/l") == "umol/L"
    assert canon_unit("x10^9/L") == "10^9/L"
    assert canon_unit(" mg / dl ") == "mg/dL"
    assert algebra_factor("g/dL", "g/L") == pytest.approx(10)


def test_every_alt_unit_converts():
    for t in T.values():
        for u in t.get("alt_units") or []:
            to_canonical(1.0, u, t)  # must not raise


@pytest.mark.parametrize(
    "name,section,expected",
    [
        ("Total Cholesterol", None, "cholesterol_total"),
        ("Χοληστερίνη ολική", None, "cholesterol_total"),
        ("总胆固醇", None, "cholesterol_total"),
        ("ALT/SGPT", None, "alt"),
        ("Τρανσαμινάση SGPT", None, "alt"),
        ("Sex Hormone Binding Glo", None, "shbg"),
        ("Leukocytes", "URINALYSIS", "urine_leukocytes"),
        ("Leukocytes", "HAEMATOLOGY", "wbc"),
        ("Dihydrotestosterone, S", None, "dht"),
    ],
)
def test_alias_match(name, section, expected):
    assert cat.match(name, section)[0] == expected
