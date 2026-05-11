#!/usr/bin/env bash
# lattice-reopen — reopen a closed finding (regression handling).
#
# Usage:
#   bash scripts/lattice-reopen.sh <finding-id-or-filename> [--reason "<text>"]
#
# Behavior:
#   - Locates the YAML under .lattice/findings/closed/<sha>/<file>.yml
#   - Moves it to .lattice/findings/open/<today>/<file>.yml
#   - Strips closed_at / closed_by_commit / closed_by_pr lines
#   - Sets status: open
#   - Adds previously_closed_in: <original-sha> (preserves what supposedly fixed it)
#   - Adds optional reopen_reason: "<text>" if --reason given
#   - Idempotent — already-open findings are reported, not re-opened.
#
# When to use: someone reverts a fix, refactors break a previously-fixed defect,
# or the original "fix" turned out to be incomplete and the original findings
# YAML is the right home for the live concern.

set -euo pipefail

usage() {
  echo "usage: bash scripts/lattice-reopen.sh <finding-id-or-filename> [--reason \"<text>\"]" >&2
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

# Strip closed lifecycle fields + any prior status/reopen tracking, then append canonical reopen block.
tmp="$(mktemp)"
grep -v -E '^(closed_at|closed_by_commit|closed_by_pr|status|previously_closed_in|reopen_reason|reopened_at)[[:space:]]*:|^# Lifecycle \(set by lattice-close\.sh\)$|^# Reopen \(set by lattice-reopen\.sh\)$' "${DEST}" > "${tmp}" || true
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
