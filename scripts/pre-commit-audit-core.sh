#!/usr/bin/env bash
# Lattice pre-commit hook — deterministic core/* rule-pack scan on the files
# you're about to commit (diff-scoped, so it's fast). Surfaces secret-in-logs,
# unbounded-external-call, missing-rate-limit, in-mem-state, missing-tenant-filter,
# and silent-fallback as they're INTRODUCED — the whole point of the rule pack is
# that it runs without anyone remembering to trigger it.
#
# Installed by `lattice install-hooks`. Non-blocking by default (warns, commit
# proceeds). Set LATTICE_PRECOMMIT_BLOCK=1 to abort the commit on a hit.
# Skip a one-off commit with: git commit --no-verify.
set -u

LB="$(command -v lattice 2>/dev/null || true)"
[ -z "${LB}" ] && LB="${HOME}/.claude/lattice/scripts/lattice"
[ -f "${LB}" ] || exit 0   # lattice not installed → never block a commit

out="$(bash "${LB}" audit-core --changed --quiet 2>/dev/null)"
ec=$?

# exit 7 = changed-mode found hits (see cmd_audit_core)
if [ "${ec}" -eq 7 ] && [ -n "${out}" ]; then
  echo ""
  echo "[lattice] ⚠ core/* rule-pack hits in your staged changes:"
  printf '%s\n' "${out}" | sed 's/^/    /'
  echo "[lattice]   detail: lattice audit-core --changed   |   skip once: git commit --no-verify"
  if [ "${LATTICE_PRECOMMIT_BLOCK:-0}" = "1" ]; then
    echo "[lattice]   LATTICE_PRECOMMIT_BLOCK=1 → aborting commit." >&2
    exit 1
  fi
fi
exit 0
