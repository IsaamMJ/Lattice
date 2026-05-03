#!/usr/bin/env bash
# Lattice v0.7 pre-push hook (self-contained, tracked in user's repo at .lattice/hooks/pre-push)
#
# Behavior: warn-only. For each decision in `decisions/` with status: active,
# if any file in its `affects:` list was changed in this push and the current
# developer has not already acknowledged it (or the decision file changed since
# the ack), print a warning. Always exits 0 in v0.7 (push proceeds).
#
# Stdin: `<local_ref> <local_sha> <remote_ref> <remote_sha>` per pushed ref.
# Skip mechanism: set LATTICE_SKIP_HOOKS=1 to bypass entirely.
#
# Spec: docs/v0.7-decision-tracking.md
# Schema: docs/decision-schema.md

set -u

if [ "${LATTICE_SKIP_HOOKS:-0}" = "1" ]; then
  exit 0
fi

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "${REPO_ROOT}" || exit 0

DECISIONS_DIR="${REPO_ROOT}/decisions"
[ -d "${DECISIONS_DIR}" ] || exit 0

# No decisions → nothing to check
shopt -s nullglob
decision_files=( "${DECISIONS_DIR}"/*.md )
[ "${#decision_files[@]}" -eq 0 ] && exit 0

PY="$(command -v python3 || command -v python || true)"
if [ -z "${PY}" ]; then
  printf "[lattice] WARN: python not found, skipping decision check\n" >&2
  exit 0
fi

# Determine changed files across all pushed refs.
# Read all stdin lines (multiple refs possible).
zero_sha="0000000000000000000000000000000000000000"
empty_tree="$(git hash-object -t tree /dev/null 2>/dev/null || echo "4b825dc642cb6eb9a060e54bf8d69288fbee4904")"

changed_files_all=""
push_refs_seen=0
while read -r local_ref local_sha remote_ref remote_sha; do
  [ -z "${local_ref:-}" ] && continue
  push_refs_seen=$((push_refs_seen + 1))

  # Deletion push (local_sha is zeros) — nothing to check
  if [ "${local_sha}" = "${zero_sha}" ]; then
    continue
  fi

  if [ "${remote_sha}" = "${zero_sha}" ]; then
    # New branch — compare against the empty tree (everything is new)
    range_files="$(git diff --name-only "${empty_tree}" "${local_sha}" 2>/dev/null || true)"
  else
    range_files="$(git diff --name-only "${remote_sha}" "${local_sha}" 2>/dev/null || true)"
  fi
  changed_files_all="${changed_files_all}
${range_files}"
done

# Fallback: if no stdin (e.g. invoked manually), use last commit
if [ "${push_refs_seen}" -eq 0 ]; then
  changed_files_all="$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)"
fi

# Deduplicate, drop empty lines
changed_files="$(printf "%s\n" "${changed_files_all}" | awk 'NF' | sort -u)"
[ -z "${changed_files}" ] && exit 0

email_raw="$(git config user.email 2>/dev/null || echo "unknown")"
# Sanitize email for filesystem path: keep [a-zA-Z0-9._@-], replace others with _
email_safe="$(printf "%s" "${email_raw}" | "${PY}" -c "
import re, sys
print(re.sub(r'[^a-zA-Z0-9._@-]', '_', sys.stdin.read().strip()))
")"

# Run the per-decision check in Python. Output is human-readable warnings.
"${PY}" - "${REPO_ROOT}" "${email_safe}" "${changed_files}" -- "${decision_files[@]}" <<'PYEOF'
import os, re, subprocess, sys

try:
    import yaml
except ImportError:
    print("[lattice] WARN: PyYAML not installed, skipping decision check", file=sys.stderr)
    sys.exit(0)

repo_root = sys.argv[1]
email_safe = sys.argv[2]
changed_files = [l for l in sys.argv[3].splitlines() if l.strip()]
# argv[4] is "--", then decision file paths
decision_paths = sys.argv[5:]

changed_set = set(changed_files)

def affects_match(aff, path):
    # Folder rule: trailing slash matches all paths under it
    if aff.endswith("/"):
        return path.startswith(aff)
    # File rule: exact match
    return path == aff

def file_committed(path):
    """Return commit timestamp (unix) of last commit touching path, or None."""
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%ct", "--", path],
            cwd=repo_root, stderr=subprocess.DEVNULL
        ).decode().strip()
        return int(out) if out else None
    except (subprocess.CalledProcessError, ValueError):
        return None

warnings = []
for dpath in decision_paths:
    rel_decision = os.path.relpath(dpath, repo_root).replace(os.sep, "/")
    decision_id = os.path.splitext(os.path.basename(dpath))[0]

    try:
        with open(dpath, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError:
        continue
    if text.startswith("﻿"):
        text = text[1:]
    lines = text.splitlines()
    try:
        first = next(i for i, l in enumerate(lines) if l.strip() == "---")
        second = next(
            i for i, l in enumerate(lines[first+1:], start=first+1)
            if l.strip() == "---"
        )
    except StopIteration:
        continue
    fm_text = "\n".join(lines[first+1:second])
    try:
        fm = yaml.safe_load(fm_text) or {}
    except yaml.YAMLError:
        continue
    if not isinstance(fm, dict):
        continue
    if fm.get("status") != "active":
        continue
    affects = fm.get("affects") or []
    if not isinstance(affects, list):
        continue

    # Skip if this decision file is itself part of the push (developer just wrote it)
    if rel_decision in changed_set:
        continue

    # Find which changed files match any affects entry
    matched = []
    for aff in affects:
        if not isinstance(aff, str):
            continue
        for ch in changed_files:
            if affects_match(aff, ch) and ch not in matched:
                matched.append(ch)
    if not matched:
        continue

    # Ack check
    ack_file = os.path.join(repo_root, ".lattice", "acks", email_safe, decision_id)
    suppressed = False
    if os.path.isfile(ack_file):
        try:
            ack_mtime = int(os.path.getmtime(ack_file))
        except OSError:
            ack_mtime = 0
        decision_commit_ts = file_committed(rel_decision) or 0
        if ack_mtime >= decision_commit_ts and decision_commit_ts > 0:
            suppressed = True
    if suppressed:
        continue

    title = fm.get("title", decision_id)
    warnings.append((decision_id, title, rel_decision, matched))

if warnings:
    print("", file=sys.stderr)
    print("⚠️  Lattice: %d decision(s) reference files you changed:" % len(warnings), file=sys.stderr)
    print("", file=sys.stderr)
    for decision_id, title, rel_decision, matched in warnings:
        print("  Decision: %s (%s)" % (decision_id, title), file=sys.stderr)
        print("  File:     %s" % rel_decision, file=sys.stderr)
        print("  Touched:  %s" % matched[0], file=sys.stderr)
        for m in matched[1:]:
            print("            %s" % m, file=sys.stderr)
        print("  Review:   review the decision; if still valid:", file=sys.stderr)
        print("            lattice decision ack %s" % decision_id, file=sys.stderr)
        print("", file=sys.stderr)
    print("(v0.7 is warn-only — push will proceed.)", file=sys.stderr)
    print("", file=sys.stderr)

sys.exit(0)
PYEOF

exit 0
