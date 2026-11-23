# Security policy

Labracadabra stores medical records, so security reports are taken seriously and handled first.

## Reporting a vulnerability

**Please do not open a public issue.** Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it and the
impact you expect. You will get an acknowledgement within a week.

Only the latest version on `main` is supported.

## Threat model

Each deployment is self-hosted by one household in its own AWS account. The design assumes:

| Actor | Can | Cannot (by design) |
|---|---|---|
| Anyone on the internet | Download the static web app (public JavaScript, no data); reach Cognito's hosted login | Sign up (invitation only), call any API (there is none), read S3 objects |
| A signed-in member | Read/write their own `users/<identity-id>/` folder; read (view role) or read/write (edit role) the circles they were added to | Reach another person's folder or a circle they are not in; these limits are IAM policies, not app code |
| A malicious or malformed report | Influence the transcription of that report (prompt injection), within the space it was uploaded to | Run code, reach other spaces, or bypass the schema validation of the model's output; values from new reports are checked in the review inbox |
| A stolen session | Act as that member for at most 1 hour of AWS credentials (refresh tokens last 30 days; signing out on Cognito ends them) | Create users, change infrastructure, read the API key |

**Cost abuse** is limited by: at most 2 extractions in parallel, a page cap per document (`MAX_PAGES`), no automatic
retry of paid model calls, an alarm on unusual invocation counts, a monthly AWS budget and (recommended) a spend
limit in the Anthropic Console.

## In scope

- Access to data outside a member's own folder and circles
- Authentication or authorisation flaws in the web app, the Cognito setup or the IAM policies
- Ways to run up model or AWS costs beyond the limits above
- Injection into the web app (the CSP blocks inline scripts; HTML injection is still a bug)
- Secrets or personal data in the repository

## Out of scope

- Findings that need an already-compromised AWS account or developer machine
- The local development server (`npm run dev`), which serves `local-data/` on localhost without authentication by
  design; never expose it with `--host`
- Denial of service against the static site or Cognito's managed login (protected by AWS)

## For people who deploy it

Follow [docs/aws-hardening.md](docs/aws-hardening.md) before the first deploy, keep dependencies up to date and
consider `REQUIRE_MFA=true`.
