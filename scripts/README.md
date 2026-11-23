# Scripts

Everyday operations, made hard to get wrong. Every script:
- reads its settings from **`scripts/settings.env`** (git-ignored; copy `settings.example.env`), so there are no
  flags to remember and nothing personal goes into git;
- checks that you are **logged in to the right AWS account** (and opens the SSO login if your session expired);
- validates what you type, **shows what it is about to do and asks** before changing anything. Deleting needs the
  email typed again;
- asks for anything you leave out, so running it with no arguments always works.

**Requirements:** bash, AWS CLI v2 (logged in through IAM Identity Center), Node.js 20+ and
[uv](https://docs.astral.sh/uv/). `backup.sh` (encrypted disk image) and the Keychain option of `set-api-key.sh` are
macOS-only; `status.sh` uses BSD `date` and also needs adjusting on Linux. Contributions for Linux are welcome.

| Script | What it does |
|---|---|
| `members.sh` | Invite people, give them edit or view access to a family circle, remove them, resend an invitation, list everyone. No redeploy needed. |
| `deploy.sh` | Tests, builds, shows what will change, asks, deploys. Use it after changing code or `settings.env` (e.g. a new circle). |
| `status.sh` | Read-only health check: site, members, queues, extractor runs and errors, recent reports, AWS and Anthropic spend this month. |
| `backup.sh` | Copies all reports and data (plus the member list) into a password-protected, AES-256 encrypted disk image on your Mac. Incremental; keeps files the app deleted. Do this monthly. |
| `set-api-key.sh` | Replaces the Anthropic key the extractor uses: checks it with Anthropic first, never prints it, optionally saves it to the Keychain. |

Examples:
```bash
scripts/members.sh                                     # menu
scripts/members.sh add mum@example.com family view     # invite Mum, view-only in "family"
scripts/members.sh list
scripts/deploy.sh
scripts/status.sh
scripts/backup.sh                                      # asks for the backup password
```

Lower-level tools (still available): `extractor/.venv/bin/pmt` (`ingest`, `rebuild`, `push`, `summary`) and
`infra/scripts/build-lambda.sh`.
