#!/usr/bin/env bash
# Replace the Anthropic API key the extractor uses (stored encrypted in SSM Parameter Store).
#
#   scripts/set-api-key.sh       asks: paste a new key (hidden) or use the one in your macOS Keychain
#
# The key is checked against Anthropic before it is stored, and never printed or written to disk.
# Rotation: create a new key in the Anthropic Console, run this, check an upload works, then revoke the old key.
source "$(dirname "$0")/_lib.sh"

PARAM="/pmt/anthropic-api-key"
KEYCHAIN_SERVICE="${PMT_KEYCHAIN_SERVICE:-labracadabra-anthropic}"
setup

info "${B}Set the Anthropic API key${N} for $STACK ($AWS_REGION, parameter $PARAM)"
info "  1) paste a new key"
info "  2) use the key in the macOS Keychain ($KEYCHAIN_SERVICE)"
case "$(ask "Number" "1")" in
  1) read -r -s -p "Paste the key (hidden): " KEY; echo; FROM=pasted ;;
  2) KEY="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)" || die "No Keychain entry \"$KEYCHAIN_SERVICE\"."; FROM=keychain ;;
  *) die "Please enter 1 or 2." ;;
esac
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]')"
printf '%s' "$KEY" | grep -Eq '^sk-ant-[A-Za-z0-9_-]{20,}$' || die "That doesn't look like an Anthropic API key (sk-ant-…). Nothing was changed."
tail4="${KEY: -4}"

info "Checking the key with Anthropic…"
code="$(printf 'x-api-key: %s\nanthropic-version: 2023-06-01\n' "$KEY" |
  curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H @- https://api.anthropic.com/v1/models || echo 000)"
case "$code" in
  200) ok "Key works (…$tail4)" ;;
  401|403) die "Anthropic rejected the key (HTTP $code). Nothing was changed." ;;
  *) warn "Couldn't verify the key (HTTP $code, maybe no network)."; confirm "Store it anyway?" || die "Cancelled." ;;
esac

current="$(aws ssm get-parameter --name "$PARAM" --with-decryption --query Parameter.Value --output text 2>/dev/null || true)"
if [ "$current" = "$KEY" ]; then ok "That key is already the one in use. Nothing to do."; exit 0; fi
info "About to replace the extractor's key${current:+ (…${current: -4})} with …$tail4."
unset current
confirm "Proceed?" || die "Cancelled. Nothing was changed."

# pass the value on stdin, not on the command line (command lines are visible to other processes)
printf '{"Name":"%s","Type":"SecureString","Overwrite":true,"Value":"%s"}' "$PARAM" "$KEY" |
  aws ssm put-parameter --cli-input-json file:///dev/stdin >/dev/null
ok "Stored. Extractor instances started from now on use the new key (idle ones are replaced within about 15 minutes)."

if [ "$FROM" = "pasted" ] && confirm "Also save it in the macOS Keychain for local use ($KEYCHAIN_SERVICE)?"; then
  security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a "$USER" -w "$KEY"
  ok "Saved in the Keychain."
fi
unset KEY
info "Next: try one upload, then revoke the old key in the Anthropic Console."
