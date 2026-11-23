# Extending the test catalog

`catalog/tests.yaml` is the single source of truth for standardisation. The LLM only **transcribes** values and
*suggests* a catalog id. All unit conversion happens in code from the numbers below, so a wrong factor
here is a real bug. Please cite a source for new factors in your PR.

## Adding a test
```yaml
- id: lipoprotein_x            # stable snake_case; never rename once released
  name: Lipoprotein X
  panel: blood.lipids          # from catalog/panels.yaml
  unit: mmol/L                 # canonical (SI) unit — everything is stored in this
  mw: 123.4                    # molar mass → automatic mg/dL ⇄ mmol/L etc.
  factors: { "U/L": 0.5 }      # extra explicit conversions: canonical = value × k
  alt_units: [mg/dL]           # offered in the UI unit switcher
  ref: { low: 1.0, high: 3.0 } # fallback range (labs' own ranges always win); ref_m / ref_f for sex-specific
  limits: [0.01, 50]           # physiological bounds; outside ⇒ sent to the review inbox
  decimals: 2
  log: true                    # growth is multiplicative (shows doubling time), e.g. tumour markers
  aliases: [Lipoprotein X, Lp-X, Λιποπρωτεΐνη Χ, 脂蛋白X]
```

## Checklist
1. `cd extractor && .venv/bin/pytest`: `test_every_alt_unit_converts` must pass. Add a known-value row to
   `tests/test_units.py` for each new conversion.
2. Regenerate the web catalog: `.venv/bin/pmt catalog-json` (writes `web/src/data/catalog.json`).
3. Re-normalise existing data without new LLM calls: `.venv/bin/pmt rebuild --data ../local-data/<profile>`.
   In AWS, saving a correction in the app triggers the same rebuild.

Aliases are matched case-, accent- and punctuation-insensitively. When a name is ambiguous (e.g. "Glucose" in
blood vs urine), the report section is used to break the tie, and if it is still ambiguous the value goes to
the review inbox.
