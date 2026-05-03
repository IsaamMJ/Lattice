#!/usr/bin/env bash
# migrate-status — add `status: open` to every open finding YAML that doesn't have it.
#
# Run once per repo when adopting v0.6.3. Idempotent — running multiple times is safe.
#
# Usage:
#   bash scripts/migrate-status.sh [--findings-dir <path>]
#
# Default findings dir: .lattice/findings/open

set -euo pipefail

FINDINGS_DIR=".lattice/findings/open"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --findings-dir)
      if [ -z "${2:-}" ]; then
        echo "[migrate-status] error: --findings-dir requires a value" >&2
        exit 2
      fi
      FINDINGS_DIR="$2"; shift 2
      ;;
    *)
      echo "[migrate-status] error: unknown arg: $1" >&2
      exit 2
      ;;
  esac
done

if [ ! -d "${FINDINGS_DIR}" ]; then
  echo "[migrate-status] no findings dir at ${FINDINGS_DIR} — nothing to migrate"
  exit 0
fi

shopt -s nullglob globstar
added=0
already=0
total=0

for f in "${FINDINGS_DIR}"/**/*.yml; do
  total=$((total + 1))
  if grep -qE '^status[[:space:]]*:' "${f}"; then
    already=$((already + 1))
    continue
  fi
  # Append default status. Place it near the bottom — old findings won't have a # Triage block,
  # so we add one for clarity (idempotent because the field check above stops re-runs).
  {
    printf "\n# Triage (added by migrate-status.sh, v0.6.3)\n"
    printf "status: open\n"
  } >> "${f}"
  added=$((added + 1))
  echo "[migrate-status]   added status: open → ${f}"
done

echo "[migrate-status] total=${total} migrated=${added} already_had_status=${already}"
