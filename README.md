<p align="center"><img src="web/public/logo.svg" width="88" alt="Labracadabra logo"></p>

<h1 align="center">Labracadabra</h1>

<p align="center">
  <b>All your lab results in one place.</b><br>
  Messy PDFs and phone photos in, one clean, searchable health history out.<br>
  Self-hosted on your own AWS account, powered by your own Claude API key.
</p>

<p align="center">
  <a href="https://github.com/bbonik/labracadabra/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/bbonik/labracadabra/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-3d6ef5"></a>
  <img alt="Python 3.12" src="https://img.shields.io/badge/python-3.12-3776ab?logo=python&logoColor=white">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-Preact-3178c6?logo=typescript&logoColor=white">
  <img alt="AWS CDK" src="https://img.shields.io/badge/AWS-CDK%20v2-ff9900?logo=amazonwebservices&logoColor=white">
  <img alt="Claude" src="https://img.shields.io/badge/extraction-Claude-d97757">
</p>

<p align="center">
  <a href="#quick-start-local-no-aws">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#deploy-to-your-own-aws-account">Deploy</a> ·
  <a href="#security-and-privacy">Security & privacy</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center"><img src="docs/screenshots/tour.webp" width="900" alt="A tour of Labracadabra: overview, all blood panels, a lipid panel side by side, LDL in depth, correlation, heatmap and trends"></p>

---

Lab reports arrive as PDFs from different labs, in different units, layouts and languages. Labracadabra turns them
into **one standardised history per person**, so questions like these take one click:

- *How has my PSA moved over the last 3 years, and how fast (velocity, doubling time)?*
- *Did my LDL step down after the lifestyle change?*
- *Has this out-of-range value come back?*
- *Show my whole lipid panel over time, or testosterone against SHBG.*

Every value links back to **the exact page of the original report**, with the number highlighted, so anything that
looks off can be checked in seconds.

> [!NOTE]
> **Bring your own Claude API key.** The intelligence layer, reading each report page and transcribing its values,
> is Claude, called with **your own Anthropic API key** ([console.anthropic.com](https://console.anthropic.com)).
> You pay Anthropic directly, per use (about $0.02 per page with the default model); there is no subscription and
> no middleman. Amazon Bedrock works as an alternative. Browsing the demo needs no key at all.

> [!IMPORTANT]
> **Not a medical device.** Labracadabra organises numbers from your own reports. It does not diagnose, and its
> pattern labels (trend, step, outlier) are statistical descriptions, not medical advice. Values are transcribed by
> an AI model, which can misread; the app shows the source page so you can verify.

## Highlights

| | |
|---|---|
| 🧾 **Any lab, any format** | PDFs, scans and phone photos; English, Greek, Chinese and more. Earlier results printed in cumulative reports are picked up too. |
| 🧪 **One catalog, real units** | ~250 tests with aliases in [`catalog/tests.yaml`](catalog/tests.yaml). Unit conversion is done **in code** (molar masses, explicit factors), never by the model. Stored in SI, shown in the unit you prefer. |
| 🔁 **No double counting** | The same value on a summary page and a lab page, or repeated in a later report, becomes one point. Re-uploading a report, even a re-downloaded copy, is recognised and free. |
| 🔍 **Built-in verification** | A review inbox catches unknown names, odd units, implausible or conflicting values, each next to its highlighted source page. |
| 📈 **Analysis that respects the data** | Reference bands per lab, trends (Mann–Kendall + Theil–Sen), step changes (Pettitt), robust outliers, velocity and doubling time, panel heatmaps, X-vs-Y correlation. |
| 👨‍👩‍👧 **For a family** | Private spaces per login, several profiles per login, and **circles** with edit or view-only members, enforced by AWS IAM rather than app code. |
| 📝 **Context for every number** | Notes for a day, a period or one result (sick, not fasting, new medication…) and the menstrual cycle phase, shown next to results, on charts and in exports. Tests you don't care about can be hidden from the dashboards. |
| 🩺 **Doctor-ready output** | Print-optimised "Save as PDF" pages and a CSV export (SI or your units, ranges, flags, source page, conversion notes). |
| 💸 **Costs cents** | About $0–2/month for AWS plus ~$0.02 per page for extraction, paid with your own Claude API key. No database, no servers, no subscription. |

## Screenshots

*Click a section to expand it. Everything shown uses the synthetic demo profile from [`fixtures/`](fixtures); no
real patient data is in this repository.*

<details open>
<summary><b>📊 Dashboards: the bird's-eye view</b></summary>
<br>

Every blood panel on one page: each card shows the latest value, its flag, a sparkline against the reference band
and any detected pattern. Light and navy themes.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/blood-panels.webp" alt="All blood panels, light theme"></td>
<td width="50%"><img src="docs/screenshots/blood-panels-dark.webp" alt="All blood panels, navy theme"></td>
</tr>
</table>

| Overview: what's out of range, what's trending | Vitals & body (paper theme) |
|---|---|
| ![overview](docs/screenshots/overview.webp) | ![vitals](docs/screenshots/vitals.webp) |
</details>

<details>
<summary><b>📈 Explore & compare: graphs across tests</b></summary>
<br>

| A whole panel side by side, each with its own reference band | The same in the graphite theme |
|---|---|
| ![side by side](docs/screenshots/explore-side-by-side.webp) | ![side by side, dark](docs/screenshots/explore-side-by-side-dark.webp) |
| **Several tests on one time axis** | **X vs Y with correlation (r = 0.95)** |
| ![over time](docs/screenshots/explore-over-time.webp) | ![scatter](docs/screenshots/explore-scatter.webp) |
| **Panel heatmap: in range vs out, visit by visit** | **Velocity: change per year between results** |
| ![heatmap](docs/screenshots/explore-heatmap.webp) | ![velocity](docs/screenshots/explore-velocity.webp) |
</details>

<details>
<summary><b>🔬 One test in depth</b></summary>
<br>

Latest value, change, velocity (Theil–Sen), doubling time, detected patterns, the ranges each lab printed, and
every result with the value *as printed* and a link to its source page.

| PSA: rising trend, doubling time | LDL: step down after a change, out-of-range points in amber |
|---|---|
| ![PSA](docs/screenshots/test-psa.webp) | ![LDL](docs/screenshots/test-ldl-dark.webp) |
</details>

<details>
<summary><b>✅ Verification & documents</b></summary>
<br>

| Review inbox: values the pipeline was unsure about | Documents: every report, its lab, pages, values and AI cost |
|---|---|
| ![inbox](docs/screenshots/inbox.webp) | ![documents](docs/screenshots/documents.webp) |
</details>

<details>
<summary><b>⚙️ Settings, cost & sign-in</b></summary>
<br>

| Units and reference-range source per test | Usage & cost per run and per month |
|---|---|
| ![settings](docs/screenshots/settings.webp) | ![usage](docs/screenshots/usage.webp) |
| **Invitation-only sign-in** | **Overview, navy theme** |
| ![sign-in](docs/screenshots/signin.png) | ![overview dark](docs/screenshots/overview-dark.webp) |
</details>

<details>
<summary><b>📱 On your phone</b></summary>
<br>

<p align="center">
  <img src="docs/screenshots/phone-overview.webp" width="260" alt="Overview on a phone">&nbsp;&nbsp;
  <img src="docs/screenshots/phone-blood.webp" width="260" alt="Blood tests on a phone">&nbsp;&nbsp;
  <img src="docs/screenshots/phone-test.webp" width="260" alt="LDL detail on a phone, navy theme">
</p>
</details>

## How it works

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/architecture/architecture-dark.svg">
  <img alt="Animated architecture diagram: browser, CloudFront, Cognito, IAM, S3, SQS, Lambda and the Anthropic API" src="docs/architecture/architecture-light.svg">
</picture>

1. **Load.** The browser loads a static Preact app from CloudFront (private S3 origin, strict Content-Security-Policy).
2. **Sign in.** Cognito's hosted login: invitation only, OAuth 2 code flow with PKCE, optional or required MFA.
3. **Credentials.** The identity pool maps the user's circle memberships to IAM roles and hands the browser
   short-lived AWS credentials.
4. **Direct to S3.** There is no API server. The app reads and writes S3 directly; IAM lets each role reach only
   `users/<their-id>/` and the circles it belongs to (view-only roles cannot write).
5. **Extract.** An upload to `…/inbox/` is queued in SQS. The Lambda extractor sends the pages to Claude, which
   **only transcribes** what is printed.
6. **Compute.** Deterministic, unit-tested Python maps names to the catalog, converts units, merges duplicates and
   computes flags, then writes `results.json`.
7. **Show.** The app picks up the new results. Each value links to its highlighted source page.

### Design principles

- **Low cost by design.** Pay-per-use serverless only: no always-on servers, no database, no API gateway, no WAF.
  The model is called only to transcribe new pages, duplicates are detected *before* any call, and re-processing
  stored transcriptions costs nothing. A family's history runs on about $0–2/month of AWS plus a few cents per report.
- **The model transcribes, code computes.** Names, units, ranges, de-duplication and statistics are deterministic
  code with tests. Re-running the normalisation over stored transcriptions is free.
- **IAM is the access control.** Isolation between people and circles is enforced by AWS, not by application logic.
- **Plain files, no database.** Each profile is a folder: `docs/` (originals), `extractions/` (raw transcriptions),
  `usage/` (append-only spend log), `corrections.json`, `prefs.json` and the merged `results.json`.
- **Guardrails by default.** Concurrency cap, page cap, dead-letter queue without retries, cost alarms and a budget.

## Quick start (local, no AWS)

The web app runs locally with a synthetic demo profile. No API key and no AWS account are needed to look around:

```bash
git clone https://github.com/bbonik/labracadabra.git
cd labracadabra/web && npm install && npm run dev
# open http://localhost:5173/?profile=demo
```

To process **your own reports** locally you need your own Claude API key (create one in the
[Anthropic Console](https://console.anthropic.com) and set a monthly spend limit there), plus the extractor
(Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd extractor && uv venv --python 3.12 && uv pip install -e '.[dev]'
.venv/bin/pytest                                     # unit tests
export ANTHROPIC_API_KEY=sk-ant-...                  # your own Claude API key
.venv/bin/pmt ingest ~/Documents/my-reports --data ../local-data/me
.venv/bin/pmt summary --data ../local-data/me        # quality report: flagged values, unmapped names
```

Reload the page: the `me` profile appears, and the **Documents** page accepts uploads (drag and drop, or a
phone photo). In local mode the dev server runs the same processing as the Lambda.

<details>
<summary>macOS: keep the API key in the Keychain instead of your shell history</summary>

```bash
security add-generic-password -a "$USER" -s labracadabra-anthropic -w   # prompts for the key
```
The dev server and `scripts/set-api-key.sh` read this entry automatically when `ANTHROPIC_API_KEY` is not set.
</details>

> [!CAUTION]
> `local-data/` and common document formats are git-ignored. **Never commit real medical documents.**

## Deploy to your own AWS account

1. **Harden the account first.** [docs/aws-hardening.md](docs/aws-hardening.md) is a one-hour runbook
   (Organizations + SCP guardrails, SSO, budgets with a hard stop) that makes a surprise bill practically impossible.
2. **Configure and bootstrap** (once):
   ```bash
   cp scripts/settings.example.env scripts/settings.env   # profile, region, account, login prefix, email, circles
   # your own Claude API key, stored encrypted in your account (the extractor reads it at run time)
   aws ssm put-parameter --name /pmt/anthropic-api-key --type SecureString --value 'sk-ant-…'
   cd infra && npm install && npx cdk bootstrap && cd ..
   ```
3. **Deploy and invite** (any time):
   ```bash
   scripts/deploy.sh                    # runs the tests, builds, shows the diff, asks, deploys
   scripts/members.sh add alex@example.com family edit
   ```

Everyday operations (status, members, backups, API key rotation) are described in [scripts/README.md](scripts/README.md).

<details>
<summary><b>Deploy options</b></summary>

| `settings.env` | CDK context | Default | Meaning |
|---|---|---|---|
| `AWS_REGION` | `region` | `eu-west-1` | Region for the stack |
| `AUTH_DOMAIN_PREFIX` | `authDomainPrefix` | *(required)* | Cognito login domain prefix (globally unique) |
| `ALERT_EMAIL` | `alertEmail` | *(required)* | Budget and failure alerts |
| `CIRCLES` | `circles` | none | Sharing circles, e.g. `home:Our home,parents:Parents` |
| `INVITER_NAME` | `inviterName` | `A family member` | Name shown in invitation emails |
| `MONTHLY_BUDGET_USD` | `monthlyBudgetUsd` | `10` | AWS budget with email alerts |
| `MAX_PAGES` | `maxPages` | `100` | Longer documents are refused before any model call |
| `REQUIRE_MFA` | `requireMfa` | `false` | Require an authenticator app for every member |
| | `model` / `effort` | `claude-opus-5-5` / `medium` | Extraction model and effort |

**Amazon Bedrock** instead of the Anthropic API: the extractor supports `PMT_PROVIDER=bedrock`. In the Lambda this
needs that environment variable and `bedrock:InvokeModel`; it is not wired into the stack by default.
</details>

### Cost

AWS: about **$0–2/month** (S3, Lambda, CloudFront, Cognito's free tier). Extraction with the default model, measured
on real reports: about **$0.02 per page**, so roughly $1 for a 50–60 page check-up bundle and a few cents for a
typical 1–2 page lab report. The **Usage & cost** page shows every run, including failed ones, against an optional
monthly budget.

## Security and privacy

- **Where your data lives:** in your own AWS account, in a private, encrypted, versioned S3 bucket.
- **What leaves your account:** the pages of each uploaded report are sent to the Anthropic API (or Amazon
  Bedrock) for transcription. Review the provider's data-retention policy before uploading. Patient names and ID
  numbers are not extracted into the results.
- **Access:** invitation-only Cognito users; per-person and per-circle isolation by IAM policy; strict CSP, HSTS,
  `noindex`; no public API.
- **Cost safety:** at most 2 extractions in parallel, a page cap, no automatic retries of paid calls, alarms on
  failures and unusual load, a monthly AWS budget. Set a spend limit in the Anthropic Console as well.
- **No compliance claims:** this is a self-hosted personal tool, not a HIPAA/GDPR-certified service.

Found a vulnerability? Please report it privately, as described in [SECURITY.md](SECURITY.md).

## Repository layout

| Path | What |
|---|---|
| [`extractor/`](extractor) | Python package `pmt`: PDF chunking, Claude extraction, normalisation, merge, CLI, Lambda handler |
| [`web/`](web) | Vite + Preact + ECharts single-page app; analytics in `src/analytics/` |
| [`infra/`](infra) | AWS CDK stack (one stack, everything in it) |
| [`catalog/`](catalog) | Test catalog, panels and unit spellings (YAML); see [docs/catalog-contributing.md](docs/catalog-contributing.md) |
| [`scripts/`](scripts) | Operations: deploy, members, status, backup, API key |
| [`fixtures/`](fixtures) | Synthetic demo data and its generator |
| [`docs/`](docs) | Hardening runbook, catalog guide, architecture diagram source |

## Contributing

Contributions are welcome, especially new tests, aliases and unit spellings for the catalog, which need no code.
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Vassilios Vonikakis
