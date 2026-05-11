#!/usr/bin/env bash
# prepare-commit-msg — Lattice git hook.
# Prepends a warning comment when open CRITICAL or BLOCKER findings exist.
# Does NOT block the commit — use `lattice ci-check` in CI to gate merges.
#
# Install (one-time, from project root):
#   cp scripts/prepare-commit-msg.sh .git/hooks/prepare-commit-msg
#   chmod +x .git/hooks/prepare-commit-msg

set -euo pipefail

COMMIT_MSG_FILE="${1}"
COMMIT_SOURCE="${2:-}"

# Skip for merge/squash/amend — those messages already have context
case "${COMMIT_SOURCE}" in
  merge|squash|commit) exit 0 ;;
esac

# Locate lattice CLI: PATH first, then installed location, then local repo
LATTICE=""
if command -v lattice >/dev/null 2>&1; then
  LATTICE="lattice"
elif [ -x "${HOME}/.claude/lattice/scripts/lattice" ]; then
  LATTICE="${HOME}/.claude/lattice/scripts/lattice"
elif [ -f "scripts/lattice" ]; then
  LATTICE="bash scripts/lattice"
else
  exit 0  # lattice not installed — don't interfere with commits
fi

# ci-check exits 1 when blockers found, 0 when clean
BLOCKERS="$(${LATTICE} ci-check 2>/dev/null | grep '^  FAIL' || true)"
[ -z "${BLOCKERS}" ] && exit 0

# Prepend warning as a comment block (git strips lines starting with #)
EXISTING="$(cat "${COMMIT_MSG_FILE}")"
{
  printf '# [lattice] WARNING: open CRITICAL/BLOCKER findings:\n'
  printf '%s\n' "${BLOCKERS}" | sed 's/^/#   /'
  printf "# Run 'lattice next' for the top finding, or 'lattice ci-check' for the full list.\n"
  printf '#\n'
  printf '%s\n' "${EXISTING}"
} > "${COMMIT_MSG_FILE}"
