# Shared helpers for the scripts in this folder. Sourced, not run. Works with macOS's bash 3.2.
# Every script: loads settings.env, checks you are logged in to the RIGHT account, then shows what it will do and
# asks before changing anything.

set -euo pipefail

SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPTS_DIR/.." && pwd)"
SETTINGS="$SCRIPTS_DIR/settings.env"

if [ -t 1 ]; then
  B=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; N=$'\033[0m'
else
  B=""; DIM=""; RED=""; GRN=""; YLW=""; N=""
fi

info() { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GRN" "$N" "$*"; }
warn() { printf '%s!%s %s\n' "$YLW" "$N" "$*" >&2; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$N" >&2; exit 1; }

lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# ask "Question" [default]  → prints the answer
ask() {
  local a
  if [ -n "${2:-}" ]; then read -r -p "$1 [$2]: " a; printf '%s' "${a:-$2}"
  else read -r -p "$1: " a; printf '%s' "$a"; fi
}

# confirm "Proceed?" → returns 0 for yes. ASSUME_YES=1 (or --yes) skips the question.
confirm() {
  [ "${ASSUME_YES:-0}" = "1" ] && return 0
  local a
  read -r -p "$1 [y/N]: " a
  case "$(lower "$a")" in y|yes) return 0 ;; *) return 1 ;; esac
}

valid_email() { printf '%s' "$1" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'; }

load_settings() {
  [ -f "$SETTINGS" ] || die "Missing $SETTINGS. Copy scripts/settings.example.env to scripts/settings.env and fill it in."
  # shellcheck disable=SC1090
  . "$SETTINGS"
  : "${AWS_PROFILE:?set AWS_PROFILE in settings.env}" "${AWS_REGION:?set AWS_REGION in settings.env}"
  : "${AWS_ACCOUNT:?set AWS_ACCOUNT in settings.env}"
  STACK="${STACK:-Labracadabra}"
  export AWS_PROFILE AWS_REGION AWS_DEFAULT_REGION="$AWS_REGION" CDK_DEFAULT_REGION="$AWS_REGION" STACK
}

# Logged in (SSO session still valid) and in the account settings.env expects — or stop.
ensure_login() {
  local acct
  if ! acct="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    local sess
    sess="$(aws configure get sso_session --profile "$AWS_PROFILE" 2>/dev/null || true)"
    warn "Not logged in to AWS (profile $AWS_PROFILE). Opening the browser to sign in…"
    if [ -n "$sess" ]; then aws sso login --sso-session "$sess"; else aws sso login --profile "$AWS_PROFILE"; fi
    acct="$(aws sts get-caller-identity --query Account --output text)" || die "Still not logged in."
  fi
  [ "$acct" = "$AWS_ACCOUNT" ] || die "Logged in to account $acct, but settings.env expects $AWS_ACCOUNT. Nothing was changed."
}

stack_output() { # stack_output UserPoolId
  local v
  v="$(aws cloudformation describe-stacks --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text 2>/dev/null || true)"
  [ -n "$v" ] && [ "$v" != "None" ] || die "Stack $STACK has no output $1 (is it deployed in $AWS_REGION?)"
  printf '%s' "$v"
}

setup() { load_settings; ensure_login; }
