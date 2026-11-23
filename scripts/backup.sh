#!/usr/bin/env bash
# Copy everything in Labracadabra (all reports, transcriptions, corrections, settings, plus the member list) into a
# password-protected, encrypted disk image on this Mac. Run it now and then; later runs only fetch what changed.
#
#   scripts/backup.sh                       backup to ~/Labracadabra-backup.sparsebundle (created on first run)
#   scripts/backup.sh --image PATH          use another image (e.g. on an external disk)
#
# The image is AES-256 encrypted by macOS. Keep its password safe: without it the backup cannot be opened.
# To look inside: double-click the .sparsebundle in Finder and enter the password.
# Why: S3 versioning protects against mistakes, not against losing the AWS account itself.
source "$(dirname "$0")/_lib.sh"

IMAGE="$HOME/Labracadabra-backup.sparsebundle"
while [ $# -gt 0 ]; do
  case "$1" in
    --image) IMAGE="${2:?--image needs a path}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "Unknown option $1 (see --help)" ;;
  esac
done
case "$IMAGE" in *.sparsebundle) ;; *) IMAGE="$IMAGE.sparsebundle" ;; esac
case "$IMAGE" in /*) ;; *) IMAGE="$PWD/$IMAGE" ;; esac   # absolute, so the repo check below is reliable
[ "$(uname)" = "Darwin" ] || die "backup.sh uses macOS encrypted disk images (hdiutil)."
case "$IMAGE" in "$REPO"/*) die "Don't put the backup inside the repository folder (it holds medical data)." ;; esac

setup
BUCKET="$(stack_output DataBucketName)"
POOL="$(stack_output UserPoolId)"
VOLNAME="Labracadabra backup"

info "${B}Backup${N} of s3://$BUCKET → $IMAGE"
read -r -s -p "Backup password: " PW; echo
[ -n "$PW" ] || die "A password is needed."

if [ ! -d "$IMAGE" ]; then
  [ ${#PW} -ge 10 ] || die "Use at least 10 characters for a new backup password."
  read -r -s -p "Same password again: " PW2; echo
  [ "$PW" = "$PW2" ] || die "The passwords don't match. Nothing was created."
  info "Creating the encrypted image (grows as needed, up to 50 GB)…"
  printf '%s' "$PW" | hdiutil create -quiet -size 50g -type SPARSEBUNDLE -fs APFS -encryption AES-256 -stdinpass \
    -volname "$VOLNAME" "$IMAGE" || die "Could not create the image."
  ok "Created $IMAGE. Store the password in your password manager now."
fi

MNT="$(mktemp -d /tmp/labracadabra-backup.XXXXXX)"
cleanup() { hdiutil detach -quiet "$MNT" 2>/dev/null || hdiutil detach -quiet -force "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true; }
trap cleanup EXIT
printf '%s' "$PW" | hdiutil attach -quiet -nobrowse -stdinpass -mountpoint "$MNT" "$IMAGE" || die "Wrong password, or the image is damaged."
unset PW PW2

info "Downloading new and changed files…"
# no --delete: anything removed from the app stays in the backup
aws s3 sync "s3://$BUCKET" "$MNT/data" --only-show-errors --exclude "*/inbox/*"
idp() { aws cognito-idp "$@"; }
{
  echo "# Members and circles at $(date -u +%Y-%m-%dT%H:%MZ)"
  idp list-users --user-pool-id "$POOL" --query "Users[].[Attributes[?Name=='email'].Value | [0], UserStatus]" --output text
  for g in $(idp list-groups --user-pool-id "$POOL" --query "Groups[].GroupName" --output text); do
    echo "## $g"; idp list-users-in-group --user-pool-id "$POOL" --group-name "$g" --query "Users[].Attributes[?Name=='email'].Value | []" --output text
  done
} > "$MNT/members.txt"
date -u +%Y-%m-%dT%H:%M:%SZ > "$MNT/last-backup.txt"

files="$(find "$MNT/data" -type f | wc -l | tr -d ' ')"
size="$(du -sh "$MNT/data" | cut -f1 | tr -d ' ')"
ok "Backup complete: $files files, $size (encrypted in $IMAGE)."
