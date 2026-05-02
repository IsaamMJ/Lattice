#!/usr/bin/env bash
# lattice-close — mark a finding closed by moving its YAML file from open/ to closed/<commit>/
#
# Usage:
#   bash scripts/lattice-close.sh <finding-id-or-filename> [--commit <sha>] [--pr <num-or-url>]
#
# Examples:
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq                    # uses HEAD full SHA
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --commit cb88972abc...
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --pr 42
#
# Behavior:
#   - Locates the YAML file under .lattice/findings/open/*/  (sorted; deterministic if duplicates)
#   - Moves it to .lattice/findings/closed/<commit-sha>/<filename>
#   - REPLACES (not appends) closed_at + closed_by_commit + closed_by_pr fields
#   - Hard-fails if outside a git repo and no --commit given (no silent "unknown")
#   - Idempotent — already-closed findings are reported, not re-closed
#
# Requires: bash, git (unless --commit is given), grep

set -euo pipefail

usage() {
  echo "usage: bash scripts/lattice-close.sh <finding-id-or-filename> [--commit <sha>] [--pr <num-or-url>]" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

FIND="$1"
shift

COMMIT=""
PR=""

require_value_for() {
  local flag="$1" next="$2"
  if [ -z "${next}" ] || [[ "${next}" == --* ]]; then
    echo "[lattice-close] error: ${flag} requires a value" >&2
    usage
    exit 2
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit)
      require_value_for "--commit" "${2:-}"
      COMMIT="$2"; shift 2
      ;;
    --pr)
      require_value_for "--pr" "${2:-}"
      PR="$2"; shift 2
      ;;
    *)
      echo "[lattice-close] error: unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# Resolve commit. Schema requires full SHA. Hard-fail outside git if no --commit given.
if [ -z "${COMMIT}" ]; then
  if ! COMMIT="$(git rev-parse HEAD 2>/dev/null)"; then
    echo "[lattice-close] error: not in a git repo. Use --commit <full-sha> to specify." >&2
    exit 1
  fi
fi

# Strip .yml if present, normalize
FIND="${FIND%.yml}"

# Find ALL matching files under open/, sort for deterministic close order
SRC=""
shopt -s nullglob
matches=()
for f in .lattice/findings/open/*/"${FIND}.yml"; do
  matches+=("${f}")
done

if [ "${#matches[@]}" -eq 0 ]; then
  # Maybe it's already closed
  for f in .lattice/findings/closed/*/"${FIND}.yml"; do
    echo "[lattice-close] already closed: ${f}"
    exit 0
  done
  echo "[lattice-close] not found: ${FIND}.yml under .lattice/findings/open/" >&2
  exit 1
fi

# Sort lexicographically for deterministic behavior on duplicate IDs across sweep dirs
IFS=$'\n' sorted=($(printf '%s\n' "${matches[@]}" | sort))
unset IFS
SRC="${sorted[0]}"
if [ "${#sorted[@]}" -gt 1 ]; then
  echo "[lattice-close] warning: ${#sorted[@]} matches; closing deterministic first: ${SRC}" >&2
fi

DEST_DIR=".lattice/findings/closed/${COMMIT}"
mkdir -p "${DEST_DIR}"
DEST="${DEST_DIR}/${FIND}.yml"

mv "${SRC}" "${DEST}"

# REPLACE existing lifecycle fields (don't append duplicates).
# Use grep -v to strip any prior closed_at / closed_by_commit / closed_by_pr / Lifecycle marker,
# then append the canonical block.
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
tmp="$(mktemp)"
grep -v -E '^(closed_at|closed_by_commit|closed_by_pr)[[:space:]]*:|^# Lifecycle \(set by lattice-close\.sh\)$' "${DEST}" > "${tmp}" || true
mv "${tmp}" "${DEST}"

{
  printf "\n# Lifecycle (set by lattice-close.sh)\n"
  printf "closed_at: %s\n" "${NOW}"
  printf "closed_by_commit: %s\n" "${COMMIT}"
  if [ -n "${PR}" ]; then
    printf "closed_by_pr: %s\n" "${PR}"
  fi
} >> "${DEST}"

echo "[lattice-close] closed ${FIND} → ${DEST}"
echo "[lattice-close] commit=${COMMIT}${PR:+ pr=${PR}}"
