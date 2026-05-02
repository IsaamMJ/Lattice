#!/usr/bin/env bash
# Lattice migrate — moves legacy .cc-reef/audits/ findings to .lattice/findings/.
#
# Why this exists:
#   v0.4 fixed an output-path bug where the three skills wrote to .cc-reef/audits/
#   while docs said .lattice/findings/. v0.4 stopped the bleed; v0.5 cleans up
#   the legacy files left over in projects that ran pre-v0.4.
#
# Usage:
#   bash scripts/migrate.sh [--project <path>]    # default: cwd
#
# Behavior:
#   - Creates .lattice/findings/ if missing
#   - Moves every file from .cc-reef/audits/ to .lattice/findings/ (preserving filename)
#   - On filename collision, appends .legacy.<n> suffix
#   - Removes the now-empty .cc-reef/audits/ directory
#   - Leaves .cc-reef/ in place if it contains other content (e.g. notes you keep)
#   - Idempotent — safe to run multiple times

set -euo pipefail

PROJECT="$(pwd)"
if [ "${1:-}" = "--project" ] && [ -n "${2:-}" ]; then
  PROJECT="$2"
fi

LEGACY="${PROJECT}/.cc-reef/audits"
TARGET="${PROJECT}/.lattice/findings"

note() { printf "[migrate] %s\n" "$*"; }

if [ ! -d "${LEGACY}" ]; then
  note "no legacy directory at ${LEGACY} — nothing to do"
  exit 0
fi

mkdir -p "${TARGET}"
note "source: ${LEGACY}"
note "target: ${TARGET}"

moved=0
collisions=0

shopt -s nullglob
for src in "${LEGACY}"/*; do
  base=$(basename "${src}")
  dest="${TARGET}/${base}"
  if [ -e "${dest}" ]; then
    n=1
    while [ -e "${TARGET}/${base}.legacy.${n}" ]; do
      n=$((n + 1))
    done
    dest="${TARGET}/${base}.legacy.${n}"
    collisions=$((collisions + 1))
  fi
  mv "${src}" "${dest}"
  moved=$((moved + 1))
done

# Remove the now-empty audits dir
if [ -d "${LEGACY}" ] && [ -z "$(ls -A "${LEGACY}")" ]; then
  rmdir "${LEGACY}"
  note "removed empty: ${LEGACY}"
fi

# Remove parent .cc-reef if it's now empty
parent="${PROJECT}/.cc-reef"
if [ -d "${parent}" ] && [ -z "$(ls -A "${parent}")" ]; then
  rmdir "${parent}"
  note "removed empty: ${parent}"
fi

note "moved ${moved} file(s); ${collisions} collision(s) renamed with .legacy.<n> suffix"
note "done"
