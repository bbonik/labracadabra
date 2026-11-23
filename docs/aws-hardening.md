# Hardening your AWS account (before deploying)

The app itself is cheap (about $0–2/month). The real risk with a personal account is **someone getting
credentials and launching expensive resources** (GPU instances, crypto-mining). This runbook closes that
door. It takes about an hour and costs nothing except the optional GuardDuty step (and a few cents of log storage).

> Order matters: do 1 → 3 first. Everything else can follow. Already have an organization? Check who owns the
> management account (`aws organizations describe-organization`) before anything else.

## 1. Organizations: one empty management account + one workload account (15 min, free)
SCPs (the guardrails below) **never apply to the management account**, so the app must live in a member account.
1. **AWS Organizations → Create organization** from an *empty* account: it becomes the management account and
   only handles billing, logins and guardrails. Give its root user MFA (a passkey is best) and no access keys.
2. Create (or invite) the **member account** that runs the app, e.g. `labracadabra`, with its own email.

## 2. IAM Identity Center instead of IAM users (15 min, free)
In the management account, in your home region:
- **IAM Identity Center → Enable** → *Single-Region instance* with the AWS owned key is enough for personal use
  (an extra region can be added later).
- **Settings → Authentication → MFA**: *every sign-in*, allow passkeys/security keys and authenticator apps,
  *require registration at sign-in*. Register **two** devices.
- **Users → Add user** (yourself). **Permission sets → Predefined → AdministratorAccess**, session **4 hours**.
- **AWS accounts** (inside Identity Center, not the Organizations page) → tick both accounts → assign your user
  with that permission set.
- CLI with short-lived credentials only (`~/.aws/config`):
  ```ini
  [sso-session me]
  sso_start_url = https://<your-portal>.awsapps.com/start
  sso_region = <home-region>
  sso_registration_scopes = sso:account:access

  [profile labracadabra]
  sso_session = me
  sso_account_id = <member-account-id>
  sso_role_name = AdministratorAccess
  region = <home-region>
  ```
  then `aws sso login --sso-session me` and `export AWS_PROFILE=labracadabra`.
- **Deactivate, then delete, every old IAM user access key.** Never create new ones; the SCP enforces this.

## 3. Remove the member account's root login + attach the SCP (10 min, free)
- **IAM → Root access management** (management account) → enable both features, then **delete the member
  account's root credentials** (password, MFA, keys). No root login is left to steal or lose; root-only tasks
  (e.g. unlocking a broken bucket policy) are done from the management account, and password recovery can be
  re-enabled there if ever needed.
- **Organizations → Policies → Service control policies → Enable**, create a policy from
  [`scp-deny-expensive.json`](scp-deny-expensive.json) and attach it **to the member account only**.
  - Replace `eu-west-1` in the region list with your home region. Keep `us-east-1` (CloudFront, ACM and Budgets need it).
  - It denies, even to administrators: other regions; EC2 launches (no GPUs at all), containers, SageMaker,
    **all of Bedrock** (stolen credentials are used for "LLMjacking"), big-data/database services, Marketplace
    subscriptions and domain purchases; creating or changing Lambdas except by the SSO admin role or the CDK
    deploy role; IAM users, access keys and console passwords; leaving the organization; and switching off
    CloudTrail, GuardDuty, budgets or S3 Block Public Access.
  - **Verify it works** from the member account: an EC2 `run-instances --dry-run` with a real AMI ID must fail
    with `UnauthorizedOperation`, and `aws bedrock list-foundation-models` with `AccessDenied`.
- In the member account: **S3 → Block Public Access settings for this account → all on**. Delete unused roles
  with broad policies (AdministratorAccess, *FullAccess).

## 4. Budgets with a hard stop (10 min, free)
- The CDK stack creates a **monthly budget** for the member account with email alerts at 50 % and 100 % actual
  and 100 % forecast (`-c monthlyBudgetUsd=10`).
- In the **management account**, add an organization-wide budget (e.g. $20) with alerts at 50 %, 80 % and 100 %
  forecast, and a **Budget action**: at 100 % actual, automatically attach a deny-everything SCP
  (`budget-hard-stop`, created but not attached) to the member account. The action needs a role that
  `budgets.amazonaws.com` can assume with `organizations:AttachPolicy`/`DetachPolicy` on that policy.
  Billing data lags by several hours, so this is a hard *cap on the damage*, not an instant switch. To recover,
  detach `budget-hard-stop` in Organizations.
- **Cost Anomaly Detection** → monitor *AWS services*, daily email above a few dollars. It is free.

## 5. Visibility (5 min)
- **CloudTrail**: one **organization trail**, all regions, management events only (the first copy is free),
  logs to a private bucket in the management account with a 1-year expiry and log-file validation.
- **EventBridge (us-east-1) → rule on `userIdentity.type = Root`** (console sign-ins and API calls) → SNS email.
  You find out immediately if root is used.
- **GuardDuty** (optional, about $1–3/month at this scale): detects credential misuse and crypto-mining patterns.

## 6. App-level safeguards (already in the stack)
| Safeguard | Where |
|---|---|
| No public endpoints except CloudFront (static files) and the Cognito login | `infra/lib/pmt-stack.ts` |
| Cognito: **admin-created users only** (no self sign-up); TOTP MFA optional, or required with `-c requireMfa=true` (`REQUIRE_MFA=true` in settings.env) | `UserPool` |
| Each person can only read/write `users/<their-id>/…` (IAM policy variables) | `AuthenticatedRole` |
| Sharing circles: a circle's data (`circles/<id>/…`) is reachable only with that circle's role, which Cognito hands out only to members of its group; view-only roles have no write permission | `Circle*Edit` / `Circle*View` roles, `circle-<id>[-view]` groups |
| The identity pool (users' folder names) survives stack deletion | `Identities` (Retain) |
| S3: Block Public Access, TLS-only, encryption, versioning, access logs | `Data` bucket |
| Extraction Lambda: **max 2 concurrent**, 15-min timeout, DLQ after 2 tries, no retry on failure | `Extractor` |
| Documents over **100 pages** (`-c maxPages=…`, `MAX_PAGES` in settings.env) are refused before any model call | `Extractor` (`PMT_MAX_PAGES`) |
| Alarm on unusual invocation counts and on failed extractions → email | `Alerts` |
| Anthropic key in SSM Parameter Store (SecureString, free), never in code, env files or logs | `/pmt/anthropic-api-key` |
| Strict CSP, HSTS, no-referrer, `noindex` | `SecurityHeaders` |

**On the Anthropic side:** set a **monthly spend limit** in the Anthropic Console
(Settings → Limits) and use a key dedicated to this app. Even a runaway loop is capped there.

**Why no WAF?** It costs at least $5–8/month, more than the whole app. The attack surface is static files plus
Cognito's managed login, which has its own throttling. A bot hitting CloudFront can only download the
(public, non-sensitive) JavaScript bundle. If you ever add an API Gateway, revisit this.

## Deploying (after the above)
Once: copy `scripts/settings.example.env` to `scripts/settings.env` (git-ignored) and fill it in, then
```bash
aws sso login --sso-session me
export AWS_PROFILE=labracadabra AWS_REGION=<home-region>
aws ssm put-parameter --name /pmt/anthropic-api-key --type SecureString --value 'sk-ant-…'
cd infra && npm install && npx cdk bootstrap && cd ..
scripts/deploy.sh          # every later deploy too: tests, build, diff, confirm, deploy
```
Sharing circles are part of the stack (`CIRCLES` in settings.env, then `scripts/deploy.sh`). Logins and
memberships are managed without redeploying, with `scripts/members.sh` (invite, edit/view access, remove, resend,
list). Invitations contain the site link and a temporary password.
Moving data you already processed locally (copies originals and transcriptions, so nothing is extracted or paid
again; then rebuilds in S3). Sign in to the site once first, so your private folder exists; its name is the
`users/<identity-id>/` prefix in the data bucket:
```bash
extractor/.venv/bin/pmt push --data local-data/me --bucket <DataBucketName> \
  --prefix users/<identity-id>/profiles/me --dry-run      # then again without --dry-run
```
