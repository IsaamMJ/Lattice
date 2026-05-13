#!/usr/bin/env bash
# Lattice post-commit hook — auto-resolves `closed_by_commit: __PENDING__`
# placeholders to the just-created commit's SHA, then creates a follow-up
# commit to capture the YAML change.
#
# Install:
#   cp scripts/post-commit-resolve-pending.sh .git/hooks/post-commit
#   chmod +x .git/hooks/post-commit
#
# Workflow this enables:
#   lattice close <id> --reason fixed --pending     # writes __PENDING__
#   git add . && git commit -m "fix X"               # commit A (fix + YAML w/ PENDING)
#     ^ hook fires: replaces __PENDING__ with A's SHA, creates commit B
#       ("lifecycle: stamp closed_by_commit ..."). YAML's stamped SHA now
#       points to the real fix commit A — A is reachable from HEAD via B,
#       so it never gets garbage-collected.
#
# Why not amend?
#   --amend would change A's SHA (since the tree includes the rewritten YAML),
#   leaving the stamped SHA pointing at an orphaned object. After git gc, the
#   stamped SHA becomes a dead reference. A follow-up commit keeps A reachable
#   and the stamped SHA correct.
#
# Recursion safety:
#   The follow-up commit re-triggers this hook. Next pass finds no PENDING
#   markers and exits clean. No infinite loop.
#
# Safety:
#   - --no-verify on the follow-up skips pre-commit hooks (avoid loops).
#   - Touches only `.lattice/findings/closed/*.yml`. Never modifies anything
#     outside the closed directory.

set -euo pipefail

# Guard: nothing to do if no closed findings dir
[ -d .lattice/findings/closed ] || exit 0

SHA="$(git rev-parse --short HEAD 2>/dev/null || true)"
[ -z "${SHA}" ] && exit 0

shopt -s nullglob
resolved=0
for f in .lattice/findings/closed/*.yml .lattice/findings/closed/*/*.yml; do
  [ -f "${f}" ] || continue
  if grep -q '^closed_by_commit: __PENDING__$' "${f}"; then
    tmp="$(mktemp)"
    awk -v sha="${SHA}" '/^closed_by_commit: __PENDING__$/ { print "closed_by_commit: " sha; next } { print }' "${f}" > "${tmp}"
    mv "${tmp}" "${f}"
    git add "${f}"
    resolved=$((resolved + 1))
  fi
done

if [ ${resolved} -gt 0 ]; then
  # Follow-up commit (not amend). The stamped SHA points at the previous commit
  # (the actual fix), which remains reachable via this follow-up's parent link.
  git commit --no-verify -m "lifecycle: stamp closed_by_commit for ${resolved} pending finding(s) (auto)" >/dev/null
  echo "[lattice-post-commit] resolved ${resolved} pending finding(s) to ${SHA}"
fi
