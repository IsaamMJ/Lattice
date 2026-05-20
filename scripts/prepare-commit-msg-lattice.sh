#!/usr/bin/env bash
# Lattice prepare-commit-msg hook (v2.2 #84)
#
# Scans staged files against open .lattice/findings/*.yml and appends a
# one-line verify hint to the commit message when any finding's `file:`
# field overlaps the staged set.
#
# Wire via `lattice install-hooks` (installs into .git/hooks/prepare-commit-msg).
# Opt-out: set LATTICE_PREPARE_COMMIT_MSG_DISABLE=1 in the environment.

set -u

[ "${LATTICE_PREPARE_COMMIT_MSG_DISABLE:-0}" = "1" ] && exit 0

# Args from git: $1 = commit message file path, $2 = source (message|template|...|<empty>)
MSG_FILE="${1:-}"
[ -n "${MSG_FILE}" ] || exit 0
[ -f "${MSG_FILE}" ] || exit 0

# Skip if commit is amend / merge / squash etc. — only annotate fresh commits.
SOURCE="${2:-}"
case "${SOURCE}" in
  merge|squash|commit) exit 0 ;;
esac

# Need a Lattice tree. Quiet exit otherwise.
[ -d ".lattice/findings/open" ] || exit 0

# Gather staged paths
staged="$(git diff --cached --name-only 2>/dev/null || true)"
[ -z "${staged}" ] && exit 0

# Build a regex of staged files. Escape regex metachars. One per line.
# Then scan findings for `file:` lines matching any staged path.
matches=""
while IFS= read -r f; do
  [ -z "${f}" ] && continue
  # Only look at YAMLs in findings/open. Match `file:` field exactly.
  for yml in .lattice/findings/open/*.yml .lattice/findings/open/*/*.yml; do
    [ -f "${yml}" ] || continue
    # `file:` field — accept quoted or unquoted, exact match on the staged path
    if grep -qE "^file:[[:space:]]*[\"']?${f}[\"']?[[:space:]]*\$" "${yml}" 2>/dev/null; then
      slug="$(basename "${yml}" .yml)"
      # Get tier for sorting/printing
      tier="$(grep -E '^tier:[[:space:]]' "${yml}" | head -1 | sed -E 's/^tier:[[:space:]]*//' | tr -d '[:space:]')"
      matches="${matches}${tier:-?}|${slug}"$'\n'
    fi
  done
done <<< "${staged}"

[ -z "${matches}" ] && exit 0

# Dedup + sort by tier rank, take top 5
ranked="$(printf '%s' "${matches}" | awk -F'|' 'NF{ rank["CRITICAL"]=1; rank["BLOCKER"]=2; rank["HIGH"]=3; rank["RISK"]=4; rank["DRIFT"]=5; rank["MEDIUM"]=6; rank["WATCH"]=7; rank["LOW"]=8; r=rank[$1]?rank[$1]:99; print r"|"$0 }' | sort -u | head -5 | cut -d'|' -f2-)"
[ -z "${ranked}" ] && exit 0

# Idempotent — skip if message already mentions Lattice hint
if grep -q "^Lattice: touches files referenced by " "${MSG_FILE}" 2>/dev/null; then
  exit 0
fi

# Append (after a blank line) — keep the line short
list="$(printf '%s' "${ranked}" | awk -F'|' '{ printf "%s%s", (NR>1?", ":""), $2 } END { print "" }')"
{
  printf '\n'
  printf 'Lattice: touches files referenced by %s. Run `lattice verify` after commit.\n' "${list}"
} >> "${MSG_FILE}"

exit 0
