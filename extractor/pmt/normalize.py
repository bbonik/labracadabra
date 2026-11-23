"""Raw LLM transcription → standardised Result records (catalog mapping, unit conversion, flags)."""

from __future__ import annotations

import hashlib
import re
from datetime import date as _date

from .catalog import Catalog, norm_name
from .schema import Finding, RawExtraction, Result
from .units import UnitError, canon_unit, to_canonical

_NUM_RE = re.compile(r"^(<=|>=|≤|≥|<|>)?\s*([-+]?\d+(?:[.,]\d+)?)\s*$")
_CENSOR = {"≤": "<=", "≥": ">=", "<": "<", ">": ">", "<=": "<=", ">=": ">="}

NEGATIVE = {"negative", "neg", "nonreactive", "notdetected", "nil", "absent", "none", "normal", "notseen"}
POSITIVE = {"positive", "pos", "reactive", "detected", "present", "seen"}
_ORD = {"trace": 0.5, "1+": 1, "2+": 2, "3+": 3, "4+": 4, "+": 1, "++": 2, "+++": 3, "++++": 4}

LOW_CONFIDENCE = 0.8
DIMENSIONLESS = ("", "ratio", "pH", "SG", "SD")
# catch-all rows some labs print ("Others: Nil") — not a measurement
_PLACEHOLDER_NAMES = {"others", "other", "remarks", "remark", "comments", "comment", "notes", "note"}
# "REACTIVE > 1000", "Positive 45.2": an interpretation word printed in front of the number
_QUAL_PREFIX_RE = re.compile(r"^([A-Za-z][A-Za-z\- ]*?)\s*(?=[<>≤≥=]|\d)(.+)$")


def _rid(*parts) -> str:
    return hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:12]


def parse_number(s: str) -> tuple[float | None, str | None]:
    m = _QUAL_PREFIX_RE.match(s.strip())
    if m and _qual_norm(m.group(1)) in NEGATIVE | POSITIVE:
        s = m.group(2)
    s = s.strip().replace(" ", "").replace(" ", "")
    # drop thousands separators like 1,000 (but keep decimal commas like 4,7)
    if re.fullmatch(r"[<>≤≥=]*\d{1,3}(,\d{3})+(\.\d+)?", s):
        s = s.replace(",", "")
    m = _NUM_RE.match(s)
    if not m:
        return None, None
    return float(m.group(2).replace(",", ".")), _CENSOR.get(m.group(1) or "")


_DUR_COLON = re.compile(r"^\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:min(?:ute)?s?(?::?s(?:ec)?)?)?\s*$", re.I)
_DUR_WORDS = re.compile(r"^\s*(?:(\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?|m|')\s*)?(?:(\d+(?:\.\d+)?)\s*(?:sec(?:ond)?s?|s|\"))?\s*$", re.I)


def parse_duration_min(s: str) -> float | None:
    """'7:25', '9:32 min:s', '07 min 25 sec', '7m 25s' → minutes as a decimal (7.4167)."""
    m = _DUR_COLON.match(s)
    if m:
        a, b, c = int(m.group(1)), int(m.group(2)), m.group(3)
        return a * 60 + b + int(c) / 60 if c else a + b / 60  # h:mm:ss or mm:ss
    m = _DUR_WORDS.match(s)
    if m and (m.group(1) or m.group(2)):
        return float(m.group(1) or 0) + float(m.group(2) or 0) / 60
    return None


def parse_date(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip()
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})", s)  # day-first
        if not m:
            return None
        d, mo, y = map(int, m.groups())
        if y < 100:
            y += 2000
    try:
        return _date(y, mo, d).isoformat()
    except ValueError:
        return None


def _qual_norm(s: str) -> str:
    return re.sub(r"[^a-z0-9+]", "", s.lower().split("(")[0])


def qualitative_ordinal(text: str) -> float | None:
    k = _qual_norm(text)
    if k in NEGATIVE:
        return 0.0
    if k in POSITIVE:
        return 1.0
    return _ORD.get(k)


def _infer_unit(num: float, raw, test: dict, target: dict) -> tuple[str, str | None]:
    """No unit printed: pick the catalog unit under which the value AND the printed reference range are
    physiologically plausible (e.g. haematocrit "0.40 (0.40-0.54)" ⇒ L/L, not %). Returns (unit, issue|None)."""
    canonical = test["unit"]
    lim = target.get("limits")
    cands = list(dict.fromkeys([canonical, *(test.get("alt_units") or []), *(test.get("factors") or {}),
                                *(test.get("affine") or {})]))
    if not lim:
        return canonical, f"unit missing — assumed {canonical}"

    def fits(u: str) -> bool:
        try:
            vals = [to_canonical(x, u, test) for x in (num, raw.ref_low, raw.ref_high) if x is not None]
        except UnitError:
            return False
        return all(lim[0] <= v <= lim[1] for v in vals)

    ok = [u for u in cands if fits(u)]
    has_ref = raw.ref_low is not None or raw.ref_high is not None
    if len(ok) == 1 and (has_ref or len(cands) == 1):
        return ok[0], None  # only one plausible unit (value and lab range agree, or the test has a single unit)
    if len(ok) >= 1:
        return ok[0], f"unit missing — assumed {ok[0]}"
    return canonical, f"unit missing — assumed {canonical}"


def _ref_for(test: dict, sex: str | None) -> tuple[float | None, float | None]:
    ref = (test.get("ref_m") if sex == "M" else test.get("ref_f") if sex == "F" else None) or test.get("ref") \
        or test.get("ref_m") or {}
    return ref.get("low"), ref.get("high")


def normalize_document(
    doc_id: str,
    chunks: list[RawExtraction],
    catalog: Catalog,
    aliases: dict[str, str] | None = None,
    sex: str | None = None,
) -> tuple[list[Result], list[Finding], dict]:
    """Returns (results, findings, doc_meta) for one document."""
    aliases = aliases or {}
    page_types: dict[str, str] = {}
    labs: list[str] = []
    collected = report_date = None
    for ch in chunks:
        for p in ch.pages:
            page_types[str(p.page)] = p.type
        r = ch.report
        collected = collected or parse_date(r.collected_date)
        report_date = report_date or parse_date(r.report_date)
        sex = sex or r.patient_sex
        if r.lab_name and r.lab_name not in labs:
            labs.append(r.lab_name)
    default_date = collected or report_date

    results: list[Result] = []
    seen: set[str] = set()
    for ch in chunks:
        lab = ch.report.lab_name or (labs[0] if labs else None)
        for raw in ch.results:
            if norm_name(raw.raw_name) in _PLACEHOLDER_NAMES and _qual_norm(raw.value) in NEGATIVE | {"", "-"}:
                continue
            issues: list[str] = []
            # ── map to catalog ──
            test_id = aliases.get(norm_name(raw.raw_name))
            if not test_id and raw.catalog_id and catalog.get(raw.catalog_id):
                test_id = raw.catalog_id
            if not test_id:
                test_id, ambiguous = catalog.match(raw.raw_name, raw.section)
                if ambiguous:
                    issues.append("ambiguous test name")
            test = catalog.get(test_id)
            # same name, different measurement depending on the page (e.g. BP on a stress-test page)
            alt = (test or {}).get("on_page", {}).get(page_types.get(str(raw.page), ""))
            if alt and catalog.get(alt):
                test_id, test = alt, catalog.get(alt)
            if not test:
                issues.append("not in catalog")

            when = parse_date(raw.date) or default_date
            if not when:
                issues.append("no date")

            rec = Result(
                id=_rid(doc_id, raw.page, raw.raw_name, when, raw.value, raw.unit),
                test_id=test_id,
                raw_name=raw.raw_name,
                date=when,
                value_raw=raw.value,
                unit_raw=raw.unit,
                doc_id=doc_id,
                page=raw.page,
                page_type=page_types.get(str(raw.page)),
                source_text=raw.source_text,
                lab=lab,
                section=raw.section,
                is_historical=raw.is_historical,
                confidence=raw.confidence,
                lab_flag=raw.lab_flag,
                ref_text=raw.ref_text,
            )
            if rec.id in seen:
                continue
            seen.add(rec.id)

            if test:
                rec.kind = test.get("kind", "numeric")
                _fill_value(rec, raw, test, catalog, sex, issues)
                if test.get("merge_into"):
                    rec.test_id = test["merge_into"]
            else:
                num, censor = parse_number(raw.value)
                rec.value, rec.censor = num, censor
                rec.value_text = raw.value if num is None else None
                rec.unit = canon_unit(raw.unit) or None
                rec.ref_low, rec.ref_high = raw.ref_low, raw.ref_high
                rec.flag = raw.lab_flag

            if raw.confidence < LOW_CONFIDENCE:
                issues.append(f"low confidence ({raw.confidence:.2f})")
            rec.issues = issues
            rec.status = "flagged" if issues else "ok"
            results.append(rec)

    findings = [
        Finding(
            id=_rid(doc_id, f.page, f.title, f.impression[:60]),
            doc_id=doc_id,
            page=f.page,
            date=parse_date(f.date) or default_date,
            modality=f.modality,
            body_part=f.body_part,
            title=f.title,
            impression=f.impression,
            is_abnormal=f.is_abnormal,
        )
        for ch in chunks
        for f in ch.findings
    ]
    meta = {"collected_date": collected, "report_date": report_date, "labs": labs, "page_types": page_types,
            "patient_sex": sex}
    return results, findings, meta


def _fill_value(rec: Result, raw, test: dict, catalog: Catalog, sex: str | None, issues: list[str]) -> None:
    target = catalog.get(test.get("merge_into")) or test
    rec.unit = target["unit"] or None
    kind = test.get("kind", "numeric")

    if kind == "text":
        rec.value_text = raw.value
        rec.flag = raw.lab_flag
        return
    if kind == "qualitative":
        rec.value_text = raw.value
        rec.value = qualitative_ordinal(raw.value)
        if raw.lab_flag:
            rec.flag = raw.lab_flag
        elif raw.ref_text and _qual_norm(raw.ref_text) == _qual_norm(raw.value):
            rec.flag = None
        elif rec.value is not None and rec.value > 0 and raw.ref_text and qualitative_ordinal(raw.ref_text) == 0:
            rec.flag = "A"
        return

    num, censor = parse_number(raw.value)
    if num is None and target["unit"] == "min":
        num = parse_duration_min(raw.value)
        if num is not None:
            raw = raw.model_copy(update={"unit": "min"})
    if num is None:
        rec.value_text = raw.value
        rec.kind = "text"
        issues.append("expected a number")
        rec.flag = raw.lab_flag
        return
    unit = canon_unit(raw.unit)
    if not unit and test["unit"] not in DIMENSIONLESS:
        unit, note = _infer_unit(num, raw, test, target)
        if note:
            issues.append(note)
    try:
        rec.value = round(to_canonical(num, unit, test), 6)
        rec.censor = censor
        if raw.ref_low is not None:
            rec.ref_low = round(to_canonical(raw.ref_low, unit, test), 6)
        if raw.ref_high is not None:
            rec.ref_high = round(to_canonical(raw.ref_high, unit, test), 6)
        if rec.ref_low is not None or rec.ref_high is not None:
            rec.ref_source = "lab"
    except UnitError:
        issues.append(f"unit {raw.unit!r} not convertible to {test['unit']}")
        rec.value, rec.censor, rec.unit = num, censor, unit or None
        rec.ref_low, rec.ref_high = raw.ref_low, raw.ref_high
        rec.flag = raw.lab_flag
        return

    # some labs print guideline tiers instead of reference intervals (e.g. lipids "Desirable 40–59"):
    # for those tests the catalog cut-offs decide the flag; the printed text stays in ref_text
    catalog_ref = target.get("ref_policy") == "catalog"
    if catalog_ref:
        rec.ref_low = rec.ref_high = rec.ref_source = None
    if rec.ref_source is None:
        lo, hi = _ref_for(target, sex)
        if lo is not None or hi is not None:
            rec.ref_low, rec.ref_high, rec.ref_source = lo, hi, "catalog"

    # computed flag (lab's own flag wins when present, unless the lab's range isn't trusted)
    flag = None if catalog_ref else raw.lab_flag
    if flag is None and rec.value is not None and censor is None:
        if rec.ref_low is not None and rec.value < rec.ref_low:
            flag = "L"
        elif rec.ref_high is not None and rec.value > rec.ref_high:
            flag = "H"
    rec.flag = flag

    lim = target.get("limits")
    if lim and rec.value is not None and not (lim[0] <= rec.value <= lim[1]):
        issues.append(f"implausible value {rec.value:g} {rec.unit} (expected {lim[0]}–{lim[1]})")
