#!/usr/bin/env bash
# Deploy (or update) Labracadabra with the settings in scripts/settings.env.
#
#   scripts/deploy.sh          run the tests, build, show what will change, ask, deploy
#   scripts/deploy.sh --yes    same without the question
#
# Safe to run any time: if nothing changed, nothing happens. Reports and logins are never deleted by a deploy.
source "$(dirname "$0")/_lib.sh"
[ "${1:-}" = "--yes" ] && ASSUME_YES=1

setup
: "${AUTH_DOMAIN_PREFIX:?set AUTH_DOMAIN_PREFIX in settings.env}" "${ALERT_EMAIL:?set ALERT_EMAIL in settings.env}"
CTX=(-c "region=$AWS_REGION" -c "stackName=$STACK" -c "authDomainPrefix=$AUTH_DOMAIN_PREFIX" -c "alertEmail=$ALERT_EMAIL"
     -c "circles=${CIRCLES:-}" -c "inviterName=${INVITER_NAME:-A family member}" -c "monthlyBudgetUsd=${MONTHLY_BUDGET_USD:-10}"
     -c "maxPages=${MAX_PAGES:-100}" -c "requireMfa=${REQUIRE_MFA:-false}")

info "${B}Deploying $STACK${N} to account $AWS_ACCOUNT, $AWS_REGION ${DIM}(circles: ${CIRCLES:-none})${N}"

info "1/4 tests"
(cd "$REPO/extractor" && .venv/bin/python -m pytest -q >/dev/null) || die "Extractor tests fail. Run: cd extractor && .venv/bin/python -m pytest"
(cd "$REPO/web" && npx tsc --noEmit -p .) || die "Web app has type errors (see above)."
(cd "$REPO/infra" && npx tsc --noEmit -p .) || die "Infrastructure code has type errors (see above)."
ok "tests pass"

info "2/4 build"
(cd "$REPO/infra" && npm run --silent build:lambda >/dev/null && npm run --silent build:web >/dev/null) || die "Build failed."
ok "Lambda bundle and web app built"

info "3/4 what will change"
cd "$REPO/infra"
diff_out="$(npx cdk diff "${CTX[@]}" 2>&1 | grep -v '^AI agent' || true)"
if printf '%s' "$diff_out" | grep -q "There were no differences"; then
  ok "infrastructure unchanged (the web app files are still re-uploaded if they changed)"
else
  printf '%s\n' "$diff_out" | grep -E '^\[[-+~]\] ' | head -40
  # resource lines only ("[~] AWS::Type Path Id may be replaced", "[-] AWS::…"). The site-file copier
  # (Custom::CDKBucketDeployment) is always "may be replaced" when the web app changes: harmless.
  risky="$(printf '%s\n' "$diff_out" | grep -E '^\[-\] AWS::|^\[~\] AWS::.*replace' || true)"
  if [ -n "$risky" ]; then
    warn "These will be REMOVED or REPLACED:"
    printf '%s\n' "$risky" | sed 's/^/    /' >&2
    # a new user pool = everyone loses their login and private space; a new data bucket = an empty app
    if printf '%s' "$risky" | grep -Eq 'AWS::Cognito::UserPool |AWS::Cognito::IdentityPool |AWS::S3::Bucket Data'; then
      warn "That includes the LOGINS or the DATA. Don't continue unless you know exactly why."
      [ "$(ask "Type REPLACE to continue anyway")" = "REPLACE" ] || die "Cancelled. Nothing was deployed."
    fi
  fi
fi
confirm "Deploy now?" || die "Cancelled. Nothing was deployed."

info "4/4 deploy"
npx cdk deploy "${CTX[@]}" --require-approval never 2>&1 | grep -v '^AI agent' | grep -E '✅|❌|Error|error|Outputs|\.SiteUrl|Deployment time' || true
url="$(stack_output SiteUrl)"
ok "Done: $url"
