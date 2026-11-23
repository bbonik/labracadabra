"""Load the test catalog (catalog/*.yaml) and provide name/alias lookup."""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import yaml

from . import units


def _default_dir() -> Path:
    env = os.environ.get("PMT_CATALOG_DIR")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    for p in [here.parent / "catalog", here.parents[1] / "catalog", here.parents[2] / "catalog"]:
        if (p / "tests.yaml").exists():
            return p
    raise FileNotFoundError("catalog/tests.yaml not found; set PMT_CATALOG_DIR")


def norm_name(s: str) -> str:
    """Case/accent/punctuation-insensitive key for alias matching (keeps CJK and Greek letters)."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace("µ", "u").replace("μ", "u")
    return re.sub(r"[^\w]+", "", s)


@dataclass
class Catalog:
    tests: dict[str, dict]
    panels: list[dict]
    synonyms: dict[str, str]
    alias_index: dict[str, list[str]] = field(default_factory=dict)

    def __post_init__(self) -> None:
        units.set_synonyms(self.synonyms)
        for t in self.tests.values():
            for name in [t["id"], t["name"], *(t.get("aliases") or [])]:
                k = norm_name(str(name))
                if k and t["id"] not in self.alias_index.setdefault(k, []):
                    self.alias_index[k].append(t["id"])

    def get(self, test_id: str | None) -> dict | None:
        return self.tests.get(test_id) if test_id else None

    def match(self, raw_name: str, section: str | None = None) -> tuple[str | None, bool]:
        """Return (test_id, ambiguous). Uses the report section (e.g. 'URINALYSIS') to break ties."""
        cands = self.alias_index.get(norm_name(raw_name), [])
        if len(cands) == 1:
            return cands[0], False
        if not cands:
            return None, False
        if section:
            s = section.lower()
            urine = any(w in s for w in ("urin", "ούρ", "尿"))
            pref = [c for c in cands if self.tests[c]["panel"].startswith("urine") == urine]
            if len(pref) == 1:
                return pref[0], False
        return cands[0], True

    def prompt_index(self) -> str:
        """Compact catalog listing given to the LLM so it can suggest catalog ids."""
        lines = []
        for t in self.tests.values():
            if t.get("merge_into"):
                continue
            lines.append(f"{t['id']} | {t['name']} | {t['unit'] or '-'} | {t['panel']}")
        lines.append("bun | Blood urea nitrogen (BUN, reported as nitrogen) | mmol/L | blood.kidney")
        return "\n".join(lines)

    def panel_name(self, panel_id: str) -> str:
        for p in self.panels:
            if p["id"] == panel_id:
                return p["name"]
            for c in p.get("children", []):
                if c["id"] == panel_id:
                    return c["name"]
        return panel_id


@lru_cache(maxsize=4)
def load(catalog_dir: str | None = None) -> Catalog:
    d = Path(catalog_dir) if catalog_dir else _default_dir()
    tests_list = yaml.safe_load((d / "tests.yaml").read_text())
    panels = yaml.safe_load((d / "panels.yaml").read_text())
    syn = yaml.safe_load((d / "units.yaml").read_text())["synonyms"]
    units.set_synonyms(syn)
    tests: dict[str, dict] = {}
    for t in tests_list:
        if t["id"] in tests:
            raise ValueError(f"duplicate test id {t['id']}")
        t.setdefault("kind", "numeric")
        t["unit"] = units.canon_unit(t.get("unit", "")) if t.get("unit") not in ("", None) else ""
        # canonicalise unit spellings in conversion maps
        for key in ("factors", "affine"):
            if t.get(key):
                t[key] = {units.canon_unit(k): v for k, v in t[key].items()}
        tests[t["id"]] = t
    return Catalog(tests=tests, panels=panels, synonyms=syn)
