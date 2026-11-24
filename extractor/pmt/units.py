"""Unit algebra for clinical concentrations.

Handles   <amount>/<volume>   where amount ∈ {mass, molar, IU, U} with SI prefixes and volume ∈ {L, dL, mL, uL}.
Mass ⇄ molar conversion needs the analyte molar mass (g/mol).  Everything else that is not a simple
concentration (%, fL, ms, ratios…) converts only through explicit per-test factors in the catalog.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

_PREFIX = {"": 1.0, "k": 1e3, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12}
_BASE_KIND = {"g": "mass", "mol": "molar", "IU": "iu", "U": "u", "Eq": "eq"}
_VOLUME = {"L": 1.0, "dL": 0.1, "mL": 1e-3, "uL": 1e-6}

_AMOUNT_RE = re.compile(r"^(k|m|u|n|p)?(g|mol|IU|U|Eq)$")


@dataclass(frozen=True)
class Conc:
    kind: str  # mass | molar | iu | u | eq
    scale: float  # amount scale relative to the base unit, per litre


_SYNONYMS: dict[str, str] = {}


def set_synonyms(syn: dict[str, str]) -> None:
    _SYNONYMS.clear()
    _SYNONYMS.update({_key(k): v for k, v in syn.items()})
    parse_conc.cache_clear()


def _key(u: str) -> str:
    return re.sub(r"\s+", "", u).replace("μ", "µ").lower()


def canon_unit(u: str | None) -> str:
    """Normalise a unit spelling (e.g. 'mg/dl', 'µmol/L', 'x10^9/L') to the catalog spelling."""
    if u is None:
        return ""
    u = u.strip()
    if not u:
        return ""
    k = _key(u)
    if k in _SYNONYMS:
        return _SYNONYMS[k]
    return u.replace("µ", "u").replace("μ", "u").replace(" ", "")


@lru_cache(maxsize=512)
def parse_conc(unit: str) -> Conc | None:
    unit = canon_unit(unit)
    if "/" not in unit:
        return None
    num, den = unit.split("/", 1)
    m = _AMOUNT_RE.match(num)
    if not m or den not in _VOLUME:
        return None
    prefix, base = m.group(1) or "", m.group(2)
    return Conc(_BASE_KIND[base], _PREFIX[prefix] / _VOLUME[den])


def algebra_factor(src: str, dst: str, mw: float | None = None) -> float | None:
    """Return k so that value_in_dst = value_in_src × k, or None when not convertible."""
    src, dst = canon_unit(src), canon_unit(dst)
    if src == dst:
        return 1.0
    a, b = parse_conc(src), parse_conc(dst)
    if a is None or b is None:
        return None
    if a.kind == b.kind:
        return a.scale / b.scale
    if mw and {a.kind, b.kind} == {"mass", "molar"}:
        if a.kind == "mass":  # g/L → mol/L
            return a.scale / mw / b.scale
        return a.scale * mw / b.scale  # mol/L → g/L
    return None


class UnitError(ValueError):
    pass


def to_canonical(value: float, unit: str, test: dict) -> float:
    """Convert `value` expressed in `unit` into the test's canonical unit."""
    canonical = test["unit"]
    unit = canon_unit(unit)
    mw = test.get("mw")
    if unit == canonical or (not unit and canonical in ("", "ratio", "pH", "SG", "SD")):
        return value
    affine = test.get("affine") or {}
    if unit in affine:
        a, b = affine[unit]
        return a * value + b
    factors = test.get("factors") or {}
    if unit in factors:
        return value * factors[unit]
    k = algebra_factor(unit, canonical, mw)
    if k is not None:
        return value * k
    # two-step: unit → (a unit that has an explicit factor) → canonical
    for f_unit, f in factors.items():
        k = algebra_factor(unit, f_unit, mw)
        if k is not None:
            return value * k * f
    raise UnitError(f"cannot convert {unit!r} → {canonical!r} for {test['id']}")


def display_transform(unit: str, test: dict) -> tuple[float, float]:
    """(a, b) such that canonical = a × display + b.  Used to emit display tables for the web UI."""
    affine = test.get("affine") or {}
    unit = canon_unit(unit)
    if unit in affine:
        a, b = affine[unit]
        return float(a), float(b)
    return to_canonical(1.0, unit, test), 0.0
