#!/usr/bin/env bash
# lattice-reopen — reopen a closed finding (regression handling).
#
# Usage:
#   bash scripts/lattice-reopen.sh <finding-id-or-filename> --reason "<text>"
#
# Behavior:
#   - Locates the YAML under .lattice/findings/closed/<slug>.yml
#   - Moves it to .lattice/findings/open/<slug>.yml
#   - Strips closed_at / closed_by_commit / closed_by_pr lines
#   - Sets status: open
#   - Adds previously_closed_in: <original-sha> (preserves what supposedly fixed it)
#   - Adds reopen_reason: "<text>" from required --reason
#   - Idempotent — already-open findings are reported, not re-opened.
#
# When to use: someone reverts a fix, refactors break a previously-fixed defect,
# or the original "fix" turned out to be incomplete and the original findings
# YAML is the right home for the live concern.

set -euo pipefail

usage() {
  echo "usage: bash scripts/lattice-reopen.sh <finding-id-or-filename> --reason \"<text>\"" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

FIND="$1"; shift
REASON=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reason)
      if [ -z "${2:-}" ] || [[ "${2:-}" == --* ]]; then
        echo "[lattice-reopen] error: --reason requires a value" >&2
        exit 2
      fi
      REASON="$2"; shift 2
      ;;
    *)
      echo "[lattice-reopen] error: unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

[ -z "${REASON}" ] && {
  echo "[lattice-reopen] error: --reason is required. Provide context for the regression." >&2
  echo "[lattice-reopen] usage: lattice reopen <id> --reason \"<why this regressed>\"" >&2
  exit 2
}

FIND="${FIND%.yml}"

# Already open? Check flat (v0.7) and legacy date-nested
shopt -s nullglob
for f in ".lattice/findings/open/${FIND}.yml" .lattice/findings/open/*/"${FIND}.yml"; do
  [ -f "${f}" ] || continue
  echo "[lattice-reopen] already open: ${f}"
  exit 0
done

# Find the closed copy — flat (v0.7) first, then legacy nested
matches=()
for f in ".lattice/findings/closed/${FIND}.yml" .lattice/findings/closed/*/"${FIND}.yml"; do
  [ -f "${f}" ] && matches+=("${f}")
done

if [ "${#matches[@]}" -eq 0 ]; then
  echo "[lattice-reopen] not found: ${FIND}.yml under .lattice/findings/closed/" >&2
  exit 1
fi

SRC="${matches[0]}"

# Extract original closing SHA from YAML field (v0.7 flat) or dirname (legacy nested)
ORIG_SHA="$(grep -E '^closed_by_commit[[:space:]]*:' "${SRC}" | head -n1 | sed -E 's/^closed_by_commit[[:space:]]*:[[:space:]]*//' | sed "s/^['\"]//; s/['\"]$//" || true)"
if [ -z "${ORIG_SHA}" ]; then
  ORIG_SHA="$(basename "$(dirname "${SRC}")")"
fi

# Destination: flat open/ (v0.7)
mkdir -p ".lattice/findings/open"
DEST=".lattice/findings/open/${FIND}.yml"

mv "${SRC}" "${DEST}"

# For legacy nested layout: clean up now-empty closed/<sha>/ dir
if [[ "${SRC}" == .lattice/findings/closed/*/* ]]; then
  rmdir "$(dirname "${SRC}")" 2>/dev/null || true
fi

# Strip closed lifecycle fields + close_reason + closure_rationale (with its
# block-scalar continuation) + prior reopen tracking. The grep-only form missed
# close_reason / closure_rationale and orphaned indented continuation lines
# after a stripped `closure_rationale: |`, corrupting subsequent sync.
tmp="$(mktemp)"
awk '
  BEGIN { skip_block=0 }
  /^(closure_rationale|remaining)[[:space:]]*:[[:space:]]*[|>]/ { skip_block=1; next }
  skip_block && /^[[:space:]]/ { next }
  skip_block && /^$/ { next }
  skip_block { skip_block=0 }
  /^(closed_at|closed_by_commit|closed_by_pr|close_reason|closure_rationale|status|partial_commits|remaining|previously_closed_in|reopen_reason|reopened_at)[[:space:]]*:/ { next }
  /^# Lifecycle \(set by lattice-close\.sh\)$/ { next }
  /^# Triage \(set by lattice-close\.sh --partial\)$/ { next }
  /^# Reopen \(set by lattice-reopen\.sh\)$/ { next }
  { print }
' "${DEST}" > "${tmp}"
mv "${tmp}" "${DEST}"

{
  printf "\n# Reopen (set by lattice-reopen.sh)\n"
  printf "status: open\n"
  printf "previously_closed_in: %s\n" "${ORIG_SHA}"
  printf "reopened_at: %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [ -n "${REASON}" ]; then
    esc_reason="$(printf "%s" "${REASON}" | sed 's/"/\\"/g')"
    printf "reopen_reason: \"%s\"\n" "${esc_reason}"
  fi
} >> "${DEST}"

echo "[lattice-reopen] reopened ${FIND} → ${DEST}"
echo "[lattice-reopen] previously_closed_in=${ORIG_SHA}"
