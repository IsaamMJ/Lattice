#!/usr/bin/env bash
# lattice-close — mark a finding closed by moving its YAML file from open/ to closed/<commit>/
#
# Usage:
#   bash scripts/lattice-close.sh <finding-id-or-filename> [--commit <sha>] [--pr <num-or-url>]
#
# Examples:
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq                    # uses HEAD commit
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --commit cb88972
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --pr 42
#
# Behavior:
#   - Locates the YAML file under .lattice/findings/open/*/
#   - Moves it to .lattice/findings/closed/<commit-sha>/<filename>
#   - Appends closed_at + closed_by_commit fields to the YAML
#   - Optionally appends closed_by_pr
#   - Idempotent — already-closed findings are reported, not re-closed

set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: bash scripts/lattice-close.sh <finding-id-or-filename> [--commit <sha>] [--pr <num-or-url>]" >&2
  exit 2
fi

FIND="$1"
shift

COMMIT=""
PR=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --pr)     PR="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Default commit = HEAD short SHA
if [ -z "${COMMIT}" ]; then
  COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
fi

# Strip .yml if present, normalize
FIND="${FIND%.yml}"

# Find the file under open/
SRC=""
shopt -s nullglob
for f in .lattice/findings/open/*/"${FIND}.yml"; do
  SRC="${f}"
  break
done

if [ -z "${SRC}" ]; then
  # Maybe it's already closed
  for f in .lattice/findings/closed/*/"${FIND}.yml"; do
    echo "[lattice-close] already closed: ${f}"
    exit 0
  done
  echo "[lattice-close] not found: ${FIND}.yml under .lattice/findings/open/" >&2
  exit 1
fi

DEST_DIR=".lattice/findings/closed/${COMMIT}"
mkdir -p "${DEST_DIR}"
DEST="${DEST_DIR}/${FIND}.yml"

mv "${SRC}" "${DEST}"

# Append lifecycle fields
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
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
