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
FROM_V05=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --project)    PROJECT="$2"; shift 2 ;;
    --from-v0.5)  FROM_V05=1; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

LEGACY="${PROJECT}/.cc-reef/audits"
TARGET="${PROJECT}/.lattice/findings"

# v0.5 → v0.6 migration: archive old multi-finding markdown files so they
# don't pollute the new YAML-per-finding layout.
if [ "${FROM_V05}" = "1" ]; then
  V05_ARCHIVE="${PROJECT}/.lattice/archive/v0.5"
  echo "[migrate] v0.5 → v0.6 archive mode"
  mkdir -p "${V05_ARCHIVE}"
  shopt -s nullglob
  v05_count=0
  for f in "${PROJECT}/.lattice/findings/"*.md; do
    [ -e "${f}" ] || continue
    base=$(basename "${f}")
    mv "${f}" "${V05_ARCHIVE}/${base}"
    v05_count=$((v05_count + 1))
  done
  echo "[migrate] archived ${v05_count} v0.5 markdown finding(s) to ${V05_ARCHIVE}"
  echo "[migrate] new v0.6 sweeps will write to ${PROJECT}/.lattice/findings/open/<date>/"
fi

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
