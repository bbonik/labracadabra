"""Data shapes: what the LLM returns (raw transcription) and what we store (normalised)."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PageType = Literal["lab_results", "summary", "ecg", "imaging", "narrative", "cover", "other"]

# ───────────── raw LLM output (one per chunk) ─────────────


class RawPage(BaseModel):
    page: int
    type: PageType
    language: Optional[str] = None


class RawReport(BaseModel):
    collected_date: Optional[str] = None
    report_date: Optional[str] = None
    lab_name: Optional[str] = None
    patient_sex: Optional[Literal["M", "F"]] = None


class RawResult(BaseModel):
    page: int
    section: Optional[str] = None
    raw_name: str
    value: str
    unit: Optional[str] = None
    ref_low: Optional[float] = None
    ref_high: Optional[float] = None
    ref_text: Optional[str] = None
    lab_flag: Optional[Literal["H", "L", "A"]] = None
    date: Optional[str] = None
    is_historical: bool = False
    source_text: str = ""
    catalog_id: Optional[str] = None
    confidence: float = 1.0


class RawFinding(BaseModel):
    page: int
    modality: str
    body_part: Optional[str] = None
    title: str
    impression: str
    is_abnormal: Optional[bool] = None
    date: Optional[str] = None


class RawExtraction(BaseModel):
    pages: list[RawPage] = Field(default_factory=list)
    report: RawReport = Field(default_factory=RawReport)
    results: list[RawResult] = Field(default_factory=list)
    findings: list[RawFinding] = Field(default_factory=list)


def _nullable(t: str | list) -> dict:
    return {"type": [t, "null"]} if isinstance(t, str) else {"anyOf": [t, {"type": "null"}]}


def _obj(props: dict) -> dict:
    return {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}


# Hand-written strict JSON schema for output_config.format (all fields required, nullable where optional).
EXTRACTION_JSON_SCHEMA: dict = _obj(
    {
        "pages": {
            "type": "array",
            "items": _obj(
                {
                    "page": {"type": "integer"},
                    "type": {"type": "string", "enum": list(PageType.__args__)},
                    "language": _nullable("string"),
                }
            ),
        },
        "report": _obj(
            {
                "collected_date": _nullable("string"),
                "report_date": _nullable("string"),
                "lab_name": _nullable("string"),
                "patient_sex": _nullable({"type": "string", "enum": ["M", "F"]}),
            }
        ),
        "results": {
            "type": "array",
            "items": _obj(
                {
                    "page": {"type": "integer"},
                    "section": _nullable("string"),
                    "raw_name": {"type": "string"},
                    "value": {"type": "string"},
                    "unit": _nullable("string"),
                    "ref_low": _nullable("number"),
                    "ref_high": _nullable("number"),
                    "ref_text": _nullable("string"),
                    "lab_flag": _nullable({"type": "string", "enum": ["H", "L", "A"]}),
                    "date": _nullable("string"),
                    "is_historical": {"type": "boolean"},
                    "source_text": {"type": "string"},
                    "catalog_id": _nullable("string"),
                    "confidence": {"type": "number"},
                }
            ),
        },
        "findings": {
            "type": "array",
            "items": _obj(
                {
                    "page": {"type": "integer"},
                    "modality": {"type": "string"},
                    "body_part": _nullable("string"),
                    "title": {"type": "string"},
                    "impression": {"type": "string"},
                    "is_abnormal": _nullable("boolean"),
                    "date": _nullable("string"),
                }
            ),
        },
    }
)

# ───────────── stored, normalised records ─────────────


class Result(BaseModel):
    id: str
    test_id: Optional[str]  # None ⇒ unmapped (shows in Inbox)
    raw_name: str
    date: Optional[str]
    kind: Literal["numeric", "qualitative", "text"] = "numeric"
    value: Optional[float] = None  # canonical unit
    censor: Optional[Literal["<", ">", "<=", ">="]] = None
    value_text: Optional[str] = None  # qualitative / text / original string
    unit: Optional[str] = None  # canonical unit
    value_raw: str
    unit_raw: Optional[str] = None
    ref_low: Optional[float] = None  # canonical unit
    ref_high: Optional[float] = None
    ref_text: Optional[str] = None
    ref_source: Optional[Literal["lab", "catalog"]] = None
    flag: Optional[Literal["H", "L", "A"]] = None
    lab_flag: Optional[str] = None
    doc_id: str
    page: int
    page_type: Optional[str] = None
    source_text: str = ""
    lab: Optional[str] = None
    section: Optional[str] = None
    is_historical: bool = False
    confidence: float = 1.0
    status: Literal["ok", "flagged", "user_corrected", "ignored", "duplicate", "superseded"] = "ok"
    issues: list[str] = Field(default_factory=list)
    also_in: list[dict] = Field(default_factory=list)  # other sources reporting the same value


class Finding(BaseModel):
    id: str
    doc_id: str
    page: int
    date: Optional[str]
    modality: str
    body_part: Optional[str] = None
    title: str
    impression: str
    is_abnormal: Optional[bool] = None


class Document(BaseModel):
    id: str
    filename: str
    sha256: str
    content_sha: Optional[str] = None  # see pdf.content_fingerprint (same report, different bytes)
    pages: int
    media_type: str
    uploaded_at: str
    report_date: Optional[str] = None
    collected_date: Optional[str] = None
    labs: list[str] = Field(default_factory=list)
    page_types: dict[str, str] = Field(default_factory=dict)
    status: Literal["queued", "processing", "done", "failed"] = "done"
    error: Optional[str] = None
    model: Optional[str] = None
    usage: dict = Field(default_factory=dict)
    cost_usd: Optional[float] = None
    duplicate_of: Optional[str] = None  # every value is already in this (earlier) document: a re-scan / photo copy
    superseded_by: Optional[str] = None  # the user chose this newer (corrected) version instead
