# Contributing to Labracadabra

Thanks for helping! Bug reports, catalog additions, fixes and features are all welcome.

## Ground rules

- **Never attach or commit real medical documents or values**, not even "anonymised" ones, in issues, pull
  requests or test fixtures. Use the synthetic generator in [`fixtures/make_demo.py`](fixtures/make_demo.py) or
  invent values. If a bug depends on a report's layout, describe the layout or retype a few made-up lines.
- **The model transcribes, code computes.** Anything that can be done deterministically (unit conversion, name
  mapping, de-duplication, statistics) belongs in tested code, not in the prompt.
- Keep changes focused, and explain the *why* in the pull request.
- Be kind: this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).

## Easiest first contribution: the catalog

New tests, aliases (any language) and unit spellings need no application code. See
[docs/catalog-contributing.md](docs/catalog-contributing.md); please cite a source for new conversion factors.

## Development setup

Requirements: Python 3.12 with [uv](https://docs.astral.sh/uv/), Node.js 24+ (npm 11).

```bash
# extractor (Python)
cd extractor && uv venv --python 3.12 && uv pip install -e '.[dev]'
.venv/bin/pytest

# web app (TypeScript / Preact)
cd web && npm install
npm run typecheck && npm test
npm run dev                         # http://localhost:5173/?profile=demo

# infrastructure (AWS CDK), type check only; no AWS account needed
cd infra && npm install && npx tsc --noEmit -p .
```

CI runs the same checks on every pull request.

## Where things live

| Change | Look at |
|---|---|
| How pages are sent to the model, the prompt | `extractor/pmt/llm.py`, `extractor/pmt/prompt.py` |
| Name mapping, units, plausibility checks | `extractor/pmt/normalize.py`, `extractor/pmt/units.py` |
| Merging duplicates, corrections, `results.json` | `extractor/pmt/merge.py`, `extractor/pmt/pipeline.py` |
| Trend, step and outlier detection | `web/src/analytics/` |
| Views and charts | `web/src/views/`, `web/src/components/` |
| AWS resources, IAM policies | `infra/lib/pmt-stack.ts` |

Changes to `infra/lib/pmt-stack.ts` that touch IAM, Cognito or S3 policies get extra review; please describe the
security impact in the pull request.

## Architecture diagram

The README diagram is generated: edit [`docs/architecture/build_diagram.py`](docs/architecture/build_diagram.py)
and run `python3 docs/architecture/build_diagram.py`.

Screenshots come from the synthetic demo profile; see [`docs/screenshots/tools/capture.mjs`](docs/screenshots/tools/capture.mjs)
to regenerate them after UI changes. The image shown when the repository link is shared comes from
[`docs/screenshots/tools/social-preview.html`](docs/screenshots/tools/social-preview.html) (`node social-preview.mjs`).

## Reporting security issues

Please don't open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).

## Licence

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
