#!/usr/bin/env bash
# Who can sign in to Labracadabra, and which family circles they see. No redeploy needed.
#
#   scripts/members.sh                                  interactive menu
#   scripts/members.sh list                             everyone, their status and circles
#   scripts/members.sh add    [email] [circle|private] [edit|view]
#                                                       invite someone (emails a temporary password + the link),
#                                                       or change an existing member's circle/role
#   scripts/members.sh remove [email] [circle]          take someone out of a circle (they keep their own login)
#   scripts/members.sh resend [email]                   send the invitation again (expired temporary password)
#   scripts/members.sh delete [email]                   delete someone's login entirely
#
# Missing arguments are asked for. Add --yes to skip the confirmation (for scripting).
# Changes to circles take effect at the member's next sign-in; "remove" and "delete" also sign them out now.
source "$(dirname "$0")/_lib.sh"

ARGS=()
for a in "$@"; do
  if [ "$a" = "--yes" ] || [ "$a" = "-y" ]; then ASSUME_YES=1; else ARGS+=("$a"); fi
done
set -- ${ARGS[@]+"${ARGS[@]}"}

setup
POOL="$(stack_output UserPoolId)"
idp() { aws cognito-idp "$@"; }

# ───────────── lookups ─────────────
circles() { # deployed circle ids, one per line
  idp list-groups --user-pool-id "$POOL" --query "Groups[?starts_with(GroupName,'circle-')].GroupName" --output text |
    tr '\t' '\n' | grep -v -- '-view$' | sed 's/^circle-//' | sort
}

user_of() { # email → Cognito username ("" if none)
  local u
  u="$(idp list-users --user-pool-id "$POOL" --filter "email = \"$1\"" --query "Users[0].Username" --output text)"
  [ "$u" = "None" ] && u=""
  printf '%s' "$u"
}

status_of() { idp admin-get-user --user-pool-id "$POOL" --username "$1" --query UserStatus --output text; }

groups_of() { idp admin-list-groups-for-user --user-pool-id "$POOL" --username "$1" --query "Groups[].GroupName" --output text | tr '\t' ' '; }

describe_groups() { # "circle-family circle-x-view" → "family (edit), x (view)"
  local out="" g
  for g in $1; do
    case "$g" in
      circle-*-view) g="${g#circle-}"; out="$out${out:+, }${g%-view} (view)" ;;
      circle-*) out="$out${out:+, }${g#circle-} (edit)" ;;
    esac
  done
  printf '%s' "${out:-private only}"
}

ask_email() {
  local e="${1:-}"
  [ -n "$e" ] || e="$(ask "Email address")"
  e="$(lower "$(printf '%s' "$e" | tr -d '[:space:]')")"
  valid_email "$e" || die "\"$e\" doesn't look like an email address."
  printf '%s' "$e"
}

ask_circle() { # [preset] → circle id or "private"
  local preset="${1:-}" list=() c i choice
  while IFS= read -r c; do [ -n "$c" ] && list+=("$c"); done < <(circles)
  if [ -n "$preset" ]; then
    preset="$(lower "$preset")"
    [ "$preset" = "private" ] && { printf 'private'; return; }
    for c in ${list[@]+"${list[@]}"}; do [ "$c" = "$preset" ] && { printf '%s' "$c"; return; }; done
    die "No circle \"$preset\". Circles: ${list[*]:-none}. (New circles are added in settings.env CIRCLES, then scripts/deploy.sh.)"
  fi
  {
    info "Which circle?"
    info "  0) none - only their own private space"
    i=1; for c in ${list[@]+"${list[@]}"}; do info "  $i) $c"; i=$((i + 1)); done
  } >&2
  choice="$(ask "Number" "1")"
  [ "$choice" = "0" ] && { printf 'private'; return; }
  case "$choice" in ''|*[!0-9]*) die "Please enter a number." ;; esac
  [ "$choice" -ge 1 ] && [ "$choice" -le "${#list[@]}" ] || die "No option $choice."
  printf '%s' "${list[$((choice - 1))]}"
}

ask_role() {
  local r="${1:-}"
  if [ -z "$r" ]; then
    info "Role in the circle:" >&2
    info "  1) edit - can see, upload and correct reports" >&2
    info "  2) view - can only look" >&2
    case "$(ask "Number" "2")" in 1) r=edit ;; 2) r=view ;; *) die "Please enter 1 or 2." ;; esac
  fi
  case "$(lower "$r")" in edit|editor) printf 'edit' ;; view|viewer|read|readonly) printf 'view' ;; *) die "Role must be edit or view." ;; esac
}

# ───────────── commands ─────────────
cmd_list() {
  local rows u e st g n=0
  info "${B}Members${N} ${DIM}(pool $POOL)${N}"
  rows="$(idp list-users --user-pool-id "$POOL" --query "Users[].[Username, Attributes[?Name=='email'].Value | [0], UserStatus, Enabled]" --output text)"
  [ -n "$rows" ] || { info "  nobody yet - add someone with: scripts/members.sh add"; return; }
  while IFS=$'\t' read -r u e st en; do
    [ -n "$u" ] || continue
    g="$(describe_groups "$(groups_of "$u")")"
    case "$st" in
      FORCE_CHANGE_PASSWORD) st="invited, not signed in yet" ;;
      CONFIRMED) st="active" ;;
    esac
    [ "$en" = "False" ] && st="$st, DISABLED"
    printf '  %-34s %-28s %s\n' "$e" "$st" "$g"
    n=$((n + 1))
  done <<< "$rows"
  info "${DIM}$n member(s). Circles: $(circles | tr '\n' ' ')${N}"
}

cmd_add() {
  local email circle role u new=0 cur
  email="$(ask_email "${1:-}")"
  circle="$(ask_circle "${2:-}")"
  [ "$circle" = "private" ] || role="$(ask_role "${3:-}")"
  u="$(user_of "$email")"
  info ""
  info "${B}About to:${N}"
  if [ -z "$u" ]; then
    new=1
    info "  • create a login for $email and email them the link and a temporary password (valid 7 days)"
  else
    cur="$(describe_groups "$(groups_of "$u")")"
    info "  • $email already has a login ($cur)"
  fi
  if [ "$circle" = "private" ]; then
    info "  • no circle: they only see their own private space"
  elif [ "$role" = "edit" ]; then
    info "  • give them EDIT access to circle \"$circle\" (see, upload, correct)"
  else
    info "  • give them VIEW-ONLY access to circle \"$circle\""
  fi
  confirm "Proceed?" || die "Cancelled. Nothing was changed."

  if [ "$new" = "1" ]; then
    idp admin-create-user --user-pool-id "$POOL" --username "$email" --desired-delivery-mediums EMAIL \
      --user-attributes Name=email,Value="$email" Name=email_verified,Value=true >/dev/null
    u="$(user_of "$email")"
    ok "Login created; invitation emailed to $email (from no-reply@verificationemail.com - ask them to check spam)."
  fi
  if [ "$circle" != "private" ]; then
    if [ "$role" = "edit" ]; then
      idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle-view" 2>/dev/null || true
      idp admin-add-user-to-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle"
    else
      idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle" 2>/dev/null || true
      idp admin-add-user-to-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle-view"
    fi
    ok "$email: $role access to \"$circle\"$([ "$new" = "1" ] || printf ' (from their next sign-in)')."
  fi
}

cmd_remove() {
  local email circle u
  email="$(ask_email "${1:-}")"
  u="$(user_of "$email")"
  [ -n "$u" ] || die "No login for $email."
  info "$email is in: $(describe_groups "$(groups_of "$u")")"
  circle="$(ask_circle "${2:-}")"
  [ "$circle" != "private" ] || die "Choose a circle to remove them from."
  info ""
  info "${B}About to:${N} remove $email from circle \"$circle\" and sign them out everywhere."
  info "  Their login and private space stay. Reports they uploaded to the circle stay in the circle."
  confirm "Proceed?" || die "Cancelled. Nothing was changed."
  idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle" 2>/dev/null || true
  idp admin-remove-user-from-group --user-pool-id "$POOL" --username "$u" --group-name "circle-$circle-view" 2>/dev/null || true
  idp admin-user-global-sign-out --user-pool-id "$POOL" --username "$u"
  ok "$email removed from \"$circle\" and signed out."
}

cmd_resend() {
  local email u
  email="$(ask_email "${1:-}")"
  u="$(user_of "$email")"
  [ -n "$u" ] || die "No login for $email. Invite them with: scripts/members.sh add $email"
  [ "$(status_of "$u")" = "FORCE_CHANGE_PASSWORD" ] ||
    die "$email has already signed in. If they forgot their password: 'Forgot your password?' on the sign-in page."
  confirm "Send a new invitation (new temporary password) to $email?" || die "Cancelled."
  idp admin-create-user --user-pool-id "$POOL" --username "$email" --message-action RESEND --desired-delivery-mediums EMAIL >/dev/null
  ok "Invitation sent again to $email."
}

cmd_delete() {
  local email u typed
  email="$(ask_email "${1:-}")"
  u="$(user_of "$email")"
  [ -n "$u" ] || die "No login for $email."
  info "${B}${RED}Delete the login of $email${N} ($(describe_groups "$(groups_of "$u")"))."
  info "  They can no longer sign in. Their private reports stay in S3 but become unreachable from the app;"
  info "  inviting the same email again creates a NEW, empty private space."
  info "  To only stop sharing, use 'remove' instead."
  if [ "${ASSUME_YES:-0}" != "1" ]; then
    typed="$(ask "Type the email again to confirm")"
    [ "$(lower "$typed")" = "$email" ] || die "Didn't match. Nothing was changed."
  fi
  idp admin-user-global-sign-out --user-pool-id "$POOL" --username "$u" || true
  idp admin-delete-user --user-pool-id "$POOL" --username "$u"
  ok "Login of $email deleted."
}

menu() {
  cmd_list
  info ""
  info "What do you want to do?"
  info "  1) invite someone / change their circle"
  info "  2) remove someone from a circle"
  info "  3) resend an invitation"
  info "  4) delete a login"
  info "  5) nothing"
  case "$(ask "Number" "5")" in
    1) cmd_add ;; 2) cmd_remove ;; 3) cmd_resend ;; 4) cmd_delete ;; *) exit 0 ;;
  esac
}

case "${1:-}" in
  "") menu ;;
  list) cmd_list ;;
  add) shift; cmd_add "$@" ;;
  remove) shift; cmd_remove "$@" ;;
  resend) shift; cmd_resend "$@" ;;
  delete) shift; cmd_delete "$@" ;;
  -h|--help|help) sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) die "Unknown command \"$1\". Try: scripts/members.sh help" ;;
esac
