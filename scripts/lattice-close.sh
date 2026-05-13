#!/usr/bin/env bash
# lattice-close — mark a finding closed (or partially closed) by updating its YAML.
#
# Usage:
#   bash scripts/lattice-close.sh <finding-id-or-filename> --reason <reason> [--commit <sha>] [--pr <num-or-url>]
#   bash scripts/lattice-close.sh <finding-id-or-filename> --partial "what's still unfixed" [--commit <sha>]
#
# Examples:
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq                    # uses HEAD short SHA (7-char)
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --commit cb88972
#   bash scripts/lattice-close.sh CRITICAL-admin-token-eq --pr 42
#   bash scripts/lattice-close.sh RISK-booking-no-tx --partial "advisory lock deferred"
#
# Behavior:
#   - SHA is normalized to 7-char short SHA (v0.6.3 convention).
#   - WITHOUT --partial: moves YAML from open/ to closed/<slug>.yml, sets closed_at + closed_by_commit.
#   - WITH    --partial: keeps YAML in open/, sets status: in_progress, appends to partial_commits, sets remaining.
#   - REPLACES (not appends) closed_at + closed_by_commit + closed_by_pr fields on full close.
#   - For --partial, partial_commits APPENDS each invocation, remaining is overwritten.
#   - Hard-fails if outside a git repo and no --commit given.
#   - Idempotent — already-closed findings are reported, not re-closed.
#
# Requires: bash, git (unless --commit is given), grep, awk

set -euo pipefail

usage() {
  cat >&2 <<USAGE
usage: bash scripts/lattice-close.sh <finding-id-or-filename> --reason <fixed|false-positive|wont-fix|out-of-scope|duplicate> [--commit <sha>] [--pr <num-or-url>]
       bash scripts/lattice-close.sh <finding-id-or-filename> --partial "<remaining text>" [--commit <sha>]
USAGE
}

yaml_scalar() {
  local key="$1" value="$2"
  if [[ "${value}" == *$'\n'* ]]; then
    printf "%s: |\n" "${key}"
    printf "%s\n" "${value}" | sed 's/^/  /'
  else
    local esc
    esc="$(printf "%s" "${value}" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf "%s: \"%s\"\n" "${key}" "${esc}"
  fi
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

FIND="$1"
shift

# Reject empty / whitespace-only id (v0.7.2 — empty substring used to match all)
if [ -z "${FIND// }" ]; then
  echo "[lattice-close] error: <finding-id> is required (empty arg)" >&2
  usage
  exit 2
fi

COMMIT=""
PR=""
PARTIAL=""
PARTIAL_MODE=0
REASON=""
RATIONALE=""
PENDING_MODE=0

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
    --partial)
      require_value_for "--partial" "${2:-}"
      PARTIAL="$2"
      PARTIAL_MODE=1
      shift 2
      ;;
    --reason)
      require_value_for "--reason" "${2:-}"
      REASON="$2"; shift 2
      ;;
    --rationale)
      require_value_for "--rationale" "${2:-}"
      RATIONALE="$2"; shift 2
      ;;
    --pending)
      # v0.7.11: stamp closed_by_commit: __PENDING__ instead of resolving HEAD.
      # Use when closing BEFORE the fix commit lands. Resolve later with
      # `lattice resolve-pending` (manual) or the post-commit hook (automatic).
      PENDING_MODE=1; shift
      ;;
    *)
      echo "[lattice-close] error: unknown arg: $1" >&2
      usage
      exit 2
      ;;
  esac
done

# Pending mode short-circuits commit resolution. SHA gets stamped as __PENDING__
# and resolved later via `lattice resolve-pending` or the post-commit hook.
if [ "${PENDING_MODE}" -eq 1 ]; then
  if [ -n "${COMMIT}" ]; then
    echo "[lattice-close] error: --pending and --commit are mutually exclusive" >&2
    exit 2
  fi
  COMMIT="__PENDING__"
else
  # Resolve commit. Hard-fail outside git if no --commit given.
  if [ -z "${COMMIT}" ]; then
    if ! COMMIT="$(git rev-parse HEAD 2>/dev/null)"; then
      echo "[lattice-close] error: not in a git repo. Use --commit <sha>, --pending, or run inside git." >&2
      exit 1
    fi
  fi
fi

# Validate reason enum (v0.7). Partial closes are still open work and do not
# require close_reason; full closes do.
if [ "${PARTIAL_MODE}" -eq 0 ] && [ -z "${REASON}" ]; then
  echo "[lattice-close] error: --reason is required for full close. Valid: fixed|false-positive|wont-fix|out-of-scope|duplicate" >&2
  exit 2
fi
[ -z "${REASON}" ] && REASON="fixed"
case "${REASON}" in
  fixed|false-positive|wont-fix|out-of-scope|duplicate) ;;
  *) echo "[lattice-close] error: invalid reason '${REASON}'. Valid: fixed|false-positive|wont-fix|out-of-scope|duplicate" >&2; exit 2 ;;
esac

# v0.7.2: resolve --commit through git rev-parse so HEAD, branch names, tags,
# and short SHAs all work uniformly (README quickstart promises `--commit HEAD`).
# v0.7.11: skip resolution when COMMIT is the __PENDING__ sentinel.
if [ "${COMMIT}" != "__PENDING__" ]; then
  if RESOLVED="$(git rev-parse --short "${COMMIT}" 2>/dev/null)"; then
    COMMIT="${RESOLVED}"
  fi
  SHORT_SHA="${COMMIT:0:7}"
  if ! [[ "${SHORT_SHA}" =~ ^[0-9a-f]{7}$ ]]; then
    echo "[lattice-close] error: --commit must be a git ref or hex SHA (got: ${COMMIT})" >&2
    exit 2
  fi
  COMMIT="${SHORT_SHA}"
fi

# Normalize accepted input forms to a filename slug.
FIND="${FIND%.yml}"
FIND="${FIND#.lattice/findings/open/}"
FIND="${FIND#.lattice/findings/closed/}"
if [[ "${FIND}" == */* ]]; then
  maybe="${FIND#*/}"
  if [[ "${maybe}" =~ ^(CRITICAL|HIGH|MEDIUM|LOW|BLOCKER|RISK|WATCH|DRIFT|INTENTIONAL|UNVERIFIABLE|OK)- ]]; then
    FIND="${maybe}"
  fi
fi

# Find ALL matching files under open/ — support flat (v0.7) and date-nested (legacy)
shopt -s nullglob
matches=()
for f in ".lattice/findings/open/${FIND}.yml" .lattice/findings/open/*/"${FIND}.yml"; do
  [ -f "${f}" ] && matches+=("${f}")
done

if [ "${#matches[@]}" -eq 0 ]; then
  for f in ".lattice/findings/closed/${FIND}.yml" .lattice/findings/closed/*/"${FIND}.yml"; do
    [ -f "${f}" ] && { echo "[lattice-close] already closed: ${f}"; exit 0; }
  done
  echo "[lattice-close] not found: ${FIND}.yml under .lattice/findings/open/" >&2
  exit 1
fi

IFS=$'\n' sorted=($(printf '%s\n' "${matches[@]}" | sort))
unset IFS
SRC="${sorted[0]}"
if [ "${#sorted[@]}" -gt 1 ]; then
  echo "[lattice-close] warning: ${#sorted[@]} matches; closing deterministic first: ${SRC}" >&2
fi

NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ---------------------------------------------------------------------------
# PARTIAL CLOSE: stay in open/, update fields in place
# ---------------------------------------------------------------------------
if [ "${PARTIAL_MODE}" -eq 1 ]; then
  # Read existing partial_commits (if any) — single-line list form: "partial_commits: [a, b]"
  existing="$(grep -E '^partial_commits:' "${SRC}" || true)"
  new_list=""
  if [ -n "${existing}" ]; then
    # Extract content between [ and ] and append
    content="$(echo "${existing}" | sed -E 's/^partial_commits:[[:space:]]*\[(.*)\][[:space:]]*$/\1/')"
    if [ -n "${content}" ]; then
      new_list="${content}, ${COMMIT}"
    else
      new_list="${COMMIT}"
    fi
  else
    new_list="${COMMIT}"
  fi

  # Strip status / partial_commits / remaining lines, then re-emit canonical block
  tmp="$(mktemp)"
  grep -v -E '^(status|partial_commits|remaining)[[:space:]]*:|^# Triage \(set by lattice-close\.sh --partial\)$' "${SRC}" > "${tmp}" || true
  mv "${tmp}" "${SRC}"

  {
    printf "\n# Triage (set by lattice-close.sh --partial)\n"
    printf "status: in_progress\n"
    printf "partial_commits: [%s]\n" "${new_list}"
    # Multiline-safe: if PARTIAL contains newlines, use YAML block scalar (|),
    # otherwise use double-quoted scalar (escape internal double-quotes).
    if [[ "${PARTIAL}" == *$'\n'* ]]; then
      printf "remaining: |\n"
      printf "%s\n" "${PARTIAL}" | sed 's/^/  /'
    else
      yaml_scalar "remaining" "${PARTIAL}"
    fi
  } >> "${SRC}"

  echo "[lattice-close] partial close: ${FIND} (status: in_progress)"
  echo "[lattice-close] partial_commits=[${new_list}]"
  echo "[lattice-close] remaining=${PARTIAL}"
  exit 0
fi

# ---------------------------------------------------------------------------
# FULL CLOSE: move to closed/<slug>.yml (v0.7 flat layout)
# ---------------------------------------------------------------------------
mkdir -p ".lattice/findings/closed"
DEST=".lattice/findings/closed/${FIND}.yml"

# Refuse to silently overwrite an existing closed finding.
if [ -e "${DEST}" ]; then
  echo "[lattice-close] error: ${DEST} already exists" >&2
  echo "[lattice-close]   refusing to overwrite. Options:" >&2
  echo "[lattice-close]     1. Reopen first if regression:  lattice reopen ${FIND}" >&2
  echo "[lattice-close]     2. Force overwrite (destructive): set LATTICE_FORCE_OVERWRITE=1" >&2
  if [ "${LATTICE_FORCE_OVERWRITE:-0}" != "1" ]; then
    exit 1
  fi
  echo "[lattice-close] LATTICE_FORCE_OVERWRITE=1 set — overwriting ${DEST}" >&2
fi

mv "${SRC}" "${DEST}"

# Strip stale lifecycle/triage/reopen lines including block-scalar continuations
# (v0.7.2 — without awk state machine, indented block-scalar lines after a
# stripped `closure_rationale: |` were orphaned, corrupting the YAML).
tmp="$(mktemp)"
awk '
  BEGIN { skip_block=0 }
  /^(closure_rationale|remaining)[[:space:]]*:[[:space:]]*[|>]/ { skip_block=1; next }
  skip_block && /^[[:space:]]/ { next }
  skip_block && /^$/ { next }
  skip_block { skip_block=0 }
  /^(status|partial_commits|remaining|closed_at|closed_by_commit|closed_by_pr|close_reason|closure_rationale|previously_closed_in|reopened_at|reopen_reason)[[:space:]]*:/ { next }
  /^# Lifecycle \(set by lattice-close\.sh\)$/ { next }
  /^# Triage \(set by lattice-close\.sh --partial\)$/ { next }
  /^# Reopen \(set by lattice-reopen\.sh\)$/ { next }
  { print }
' "${DEST}" > "${tmp}"
mv "${tmp}" "${DEST}"

{
  printf "\n# Lifecycle (set by lattice-close.sh)\n"
  printf "closed_at: %s\n" "${NOW}"
  printf "closed_by_commit: %s\n" "${COMMIT}"
  printf "close_reason: %s\n" "${REASON:-fixed}"
  if [ -n "${PR}" ]; then
    printf "closed_by_pr: %s\n" "${PR}"
  fi
  if [ -n "${RATIONALE}" ]; then
    yaml_scalar "closure_rationale" "${RATIONALE}"
  fi
} >> "${DEST}"

echo "[lattice-close] closed ${FIND} → ${DEST}"
echo "[lattice-close] commit=${COMMIT} reason=${REASON:-fixed}${PR:+ pr=${PR}}"

# v0.7.12: auto-stage both paths in git so `git commit` after close just works.
# Without this, the user sees "open/ delete (unstaged) + closed/ add (staged)"
# and a naive `git add closed/` followed by commit leaves the open/ delete
# behind, producing a half-staged state and a finding present in both dirs
# after pull on another machine.
# Falls back silently outside git or if files aren't tracked.
if git rev-parse --git-dir >/dev/null 2>&1; then
  staged=0
  git add -- "${DEST}" 2>/dev/null && staged=1 || true
  # Stage the delete of SRC if it was tracked. `git rm --cached` removes it
  # from the index regardless of working-tree state.
  git rm --cached -q -- "${SRC}" 2>/dev/null && staged=1 || true
  if [ ${staged} -eq 1 ]; then
    echo "[lattice-close] git: staged ${DEST} (add) + ${SRC} (delete)"
  fi
fi
