#!/usr/bin/env bash
# One look at how Labracadabra is doing. Read-only: changes nothing.
#
#   scripts/status.sh            site, members, extractions and errors (last 7 days), spend this month
#   scripts/status.sh --days 30  look further back
source "$(dirname "$0")/_lib.sh"

DAYS=7
[ "${1:-}" = "--days" ] && DAYS="${2:?--days needs a number}"
case "$DAYS" in ''|*[!0-9]*) die "--days needs a number" ;; esac

setup
BUCKET="$(stack_output DataBucketName)"
POOL="$(stack_output UserPoolId)"
URL="$(stack_output SiteUrl)"
res() { aws cloudformation describe-stack-resources --stack-name "$STACK" --query "StackResources[?ResourceType=='$1' && starts_with(LogicalResourceId,'$2')].PhysicalResourceId | [0]" --output text; }
FN="$(res AWS::Lambda::Function Extractor)"
LOGS="$(res AWS::Logs::LogGroup ExtractorLogs)"
since_ms=$(( ($(date +%s) - DAYS * 86400) * 1000 ))
since_iso="$(date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%SZ)"
now_iso="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

info "${B}Labracadabra status${N} ${DIM}($STACK, $AWS_REGION, last $DAYS days)${N}"

# site
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL/" || echo 000)"
st="$(aws cloudformation describe-stacks --stack-name "$STACK" --query 'Stacks[0].StackStatus' --output text)"
[ "$code" = "200" ] && ok "Site up ($URL), stack $st" || warn "Site returned HTTP $code ($URL), stack $st"

# members
rows="$(aws cognito-idp list-users --user-pool-id "$POOL" --query 'Users[].UserStatus' --output text | tr '\t' '\n' | grep -v '^$' || true)"
total="$(printf '%s\n' "$rows" | grep -c . || true)"
invited="$(printf '%s\n' "$rows" | grep -c FORCE_CHANGE_PASSWORD || true)"
ok "Members: $total ($invited invited, not signed in yet)"

# queues
for q in $(aws sqs list-queues --queue-name-prefix "$STACK" --query 'QueueUrls' --output text); do
  n="$(aws sqs get-queue-attributes --queue-url "$q" --attribute-names ApproximateNumberOfMessages --query Attributes.ApproximateNumberOfMessages --output text)"
  name="$(basename "$q")"
  case "$name" in
    *DLQ*) if [ "$n" = "0" ]; then ok "Failed-message queue empty"; else warn "$n message(s) in the failed-message queue ($name): an upload or rebuild failed twice (see the log lines below)."; fi ;;
    *) [ "$n" = "0" ] && ok "Work queue empty" || info "  $n upload(s) waiting to be processed" ;;
  esac
done

# Lambda metrics
metric() {
  aws cloudwatch get-metric-statistics --namespace AWS/Lambda --metric-name "$1" --dimensions Name=FunctionName,Value="$FN" \
    --start-time "$since_iso" --end-time "$now_iso" --period $((DAYS * 86400)) --statistics Sum --query 'Datapoints[0].Sum' --output text
}
inv="$(metric Invocations)"; err="$(metric Errors)"
[ "$inv" = "None" ] && inv=0; [ "$err" = "None" ] && err=0
inv="${inv%.*}"; err="${err%.*}"
[ "$err" = "0" ] && ok "Extractor: $inv runs, no errors" || warn "Extractor: $inv runs, $err error(s)"

# recent extractions and failures (from the extractor's own log lines)
ext="$(aws logs filter-log-events --log-group-name "$LOGS" --start-time "$since_ms" --filter-pattern '"extracted"' --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | grep -o 'extracted .*' || true)"
n_ext="$(printf '%s\n' "$ext" | grep -c . || true)"
info "  Reports extracted: $n_ext"
printf '%s\n' "$ext" | grep . | tail -5 | sed 's/^/    /' || true
fails="$(aws logs filter-log-events --log-group-name "$LOGS" --start-time "$since_ms" --filter-pattern '?ERROR ?Traceback ?failed' --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | grep . | tail -5 || true)"
if [ -n "$fails" ]; then
  warn "Recent problems in the extractor log:"
  printf '%s\n' "$fails" | cut -c1-200 | sed 's/^/    /' >&2
fi

# spend: AWS (from the budget, free to query) and Anthropic (from the app's own usage records)
acct="$AWS_ACCOUNT"
aws budgets describe-budgets --account-id "$acct" --region us-east-1 \
  --query "Budgets[].[BudgetName, CalculatedSpend.ActualSpend.Amount, CalculatedSpend.ForecastedSpend.Amount, BudgetLimit.Amount]" --output text 2>/dev/null |
  while IFS=$'\t' read -r name act fc lim; do
    [ -n "$name" ] && info "  AWS spend this month ($name): \$$(printf '%.2f' "$act") of \$$(printf '%.0f' "$lim"), forecast \$$(printf '%.2f' "${fc:-0}")"
  done
month="$(date -u +%Y%m)"
llm="$(aws s3api list-objects-v2 --bucket "$BUCKET" --query "Contents[?contains(Key,'/usage/$month')].Key" --output text 2>/dev/null | tr '\t' '\n' | grep . || true)"
total_llm=0
if [ -n "$llm" ]; then
  total_llm="$(printf '%s\n' "$llm" | while read -r k; do aws s3 cp "s3://$BUCKET/$k" - 2>/dev/null; echo; done |
    python3 -c 'import sys,json; print(round(sum(json.loads(l).get("cost_usd",0) for l in sys.stdin if l.strip()),2))')"
fi
info "  Anthropic spend this month (extractions): \$$total_llm"
