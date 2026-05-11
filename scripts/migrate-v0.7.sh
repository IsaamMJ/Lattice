#!/usr/bin/env bash
# migrate-v0.7 — one-shot migration from nested to flat finding layout.
#
# Moves:
#   open/<date>/<slug>.yml  → open/<slug>.yml   (adds first_seen_sweep: <date> if absent)
#   closed/<sha>/<slug>.yml → closed/<slug>.yml  (sets closed_by_commit from dirname if absent,
#                                                   preserves old id as legacy_id:)
#
# Idempotent: skips files already at the flat destination (destination exists).
# Safe: copies first, then removes source only after successful copy.
#
# Usage:
#   bash scripts/migrate-v0.7.sh [--dry-run]

set -euo pipefail

DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1

moved=0
skipped=0
errors=0

append_field_if_absent() {
  local file="$1" field="$2" value="$3"
  grep -qE "^${field}[[:space:]]*:" "${file}" 2>/dev/null || printf "%s: %s\n" "${field}" "${value}" >> "${file}"
}

migrate_file() {
  local src="$1" dest="$2"
  shift 2
  # Extra fields: "field=value" pairs
  local extras=("$@")

  if [ -e "${dest}" ]; then
    echo "  SKIP  ${src} (destination exists: ${dest})"
    skipped=$((skipped + 1))
    return
  fi

  if [ "${DRY_RUN}" -eq 1 ]; then
    echo "  DRY   ${src}"
    echo "        → ${dest}"
    for pair in "${extras[@]:-}"; do
      [ -z "${pair}" ] && continue
      echo "        + ${pair}"
    done
    moved=$((moved + 1))
    return
  fi

  cp "${src}" "${dest}"

  for pair in "${extras[@]:-}"; do
    [ -z "${pair}" ] && continue
    local field="${pair%%=*}"
    local value="${pair#*=}"
    append_field_if_absent "${dest}" "${field}" "${value}"
  done

  rm "${src}"
  rmdir "$(dirname "${src}")" 2>/dev/null || true
  echo "  MOVE  ${src} → ${dest}"
  moved=$((moved + 1))
}

echo "[migrate-v0.7] scanning open/ for date-nested findings ..."
shopt -s nullglob
open_count=0
for f in .lattice/findings/open/*/*.yml; do
  [ -f "${f}" ] || continue
  open_count=$((open_count + 1))
  date_part="$(basename "$(dirname "${f}")")"
  slug="$(basename "${f}")"
  dest=".lattice/findings/open/${slug}"
  migrate_file "${f}" "${dest}" "first_seen_sweep=${date_part}"
done
[ "${open_count}" -eq 0 ] && echo "  (none found)"

echo "[migrate-v0.7] scanning closed/ for sha-nested findings ..."
closed_count=0
for f in .lattice/findings/closed/*/*.yml; do
  [ -f "${f}" ] || continue
  closed_count=$((closed_count + 1))
  sha_part="$(basename "$(dirname "${f}")")"
  slug="$(basename "${f}")"
  dest=".lattice/findings/closed/${slug}"

  # Capture old id to preserve as legacy_id
  old_id="$(grep -E '^id[[:space:]]*:' "${f}" | head -n1 | sed -E 's/^id[[:space:]]*:[[:space:]]*//' | tr -d "'\""  || true)"

  extras=()
  # Add closed_by_commit from dirname if field is missing in YAML
  extras+=("closed_by_commit=${sha_part}")
  [ -n "${old_id}" ] && extras+=("legacy_id=${old_id}")

  migrate_file "${f}" "${dest}" "${extras[@]}"
done
[ "${closed_count}" -eq 0 ] && echo "  (none found)"

echo ""
echo "[migrate-v0.7] done — moved=${moved} skipped=${skipped} errors=${errors}"
[ "${DRY_RUN}" -eq 1 ] && echo "[migrate-v0.7] dry-run: no files were changed"
