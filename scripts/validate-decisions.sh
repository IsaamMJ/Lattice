#!/usr/bin/env bash
# Lattice validate-decisions — validates every decisions/*.md against the v0.7 schema.
#
# Schema: docs/decision-schema.md
# Run:    ./scripts/validate-decisions.sh [path-to-decisions-dir]
# Exit:   0 if all decisions valid (or no decisions/ dir); 1 on any failure.
#
# Requires: python3 + PyYAML (pip install pyyaml)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DECISIONS_DIR="${1:-${ROOT}/decisions}"

note() { printf "[validate-decisions] %s\n" "$*"; }
ok()   { printf "[validate-decisions]   ok: %s\n" "$*"; }
err()  { printf "[validate-decisions] FAIL: %s\n" "$*" >&2; }

if [ ! -d "${DECISIONS_DIR}" ]; then
  note "no decisions/ directory at ${DECISIONS_DIR} — nothing to validate"
  exit 0
fi

shopt -s nullglob
files=( "${DECISIONS_DIR}"/*.md )
if [ "${#files[@]}" -eq 0 ]; then
  note "decisions/ exists but is empty — nothing to validate"
  exit 0
fi

note "validating ${#files[@]} decision(s) in ${DECISIONS_DIR}"

# Run the Python validator. It prints one tab-separated line per file:
#   OK<TAB><relpath>
#   FAIL<TAB><relpath><TAB><reason>
# Exit codes:
#   0 = all valid
#   1 = one or more invalid
#   2 = environment error (e.g. PyYAML missing)
set +e
PY="$(command -v python3 || command -v python || true)"
if [ -z "${PY}" ]; then
  err "python (3.x) not found in PATH"
  exit 1
fi
output=$("${PY}" - "${files[@]}" <<'PYEOF'
import os, re, sys

try:
    import yaml  # PyYAML
except ImportError:
    sys.stderr.write(
        "PyYAML is required. Install with: pip install pyyaml\n"
    )
    sys.exit(2)

ALLOWED_STATUS = {"active", "superseded", "proposed", "deleted"}
SLUG_RE = re.compile(r"^[a-z0-9-]+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED = ["title", "why", "status", "created", "affects"]

def validate(path):
    errors = []
    slug = os.path.splitext(os.path.basename(path))[0]
    if not SLUG_RE.match(slug):
        errors.append(f"filename slug '{slug}' must match [a-z0-9-]+ (kebab-case)")

    try:
        with open(path, "r", encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return [f"cannot read file: {e}"]

    # strip optional UTF-8 BOM
    if text.startswith("﻿"):
        text = text[1:]

    if not text.lstrip().startswith("---"):
        errors.append("first non-empty line must be '---' (missing YAML frontmatter)")
        return errors

    lines = text.splitlines()
    try:
        first = next(i for i, l in enumerate(lines) if l.strip() == "---")
    except StopIteration:
        errors.append("no opening '---' line")
        return errors
    try:
        second = next(
            i for i, l in enumerate(lines[first+1:], start=first+1)
            if l.strip() == "---"
        )
    except StopIteration:
        errors.append("no closing '---' line for YAML frontmatter")
        return errors

    fm_text = "\n".join(lines[first+1:second])
    try:
        fm = yaml.safe_load(fm_text)
    except yaml.YAMLError as e:
        errors.append(f"YAML parse error: {e}")
        return errors

    if not isinstance(fm, dict):
        errors.append("frontmatter must be a YAML mapping (key: value)")
        return errors

    for k in REQUIRED:
        if k not in fm:
            errors.append(f"missing required field: '{k}'")

    for k in ("title", "why"):
        if k in fm:
            v = fm[k]
            if not isinstance(v, str) or not v.strip():
                errors.append(f"'{k}' must be a non-empty string")

    if "status" in fm and fm["status"] not in ALLOWED_STATUS:
        errors.append(
            f"'status' must be one of {sorted(ALLOWED_STATUS)} (got {fm['status']!r})"
        )

    for k in ("created", "updated"):
        if k in fm and fm[k] is not None:
            v = fm[k]
            if hasattr(v, "isoformat"):
                # PyYAML auto-parses YYYY-MM-DD into datetime.date
                if not DATE_RE.match(v.isoformat()):
                    errors.append(f"'{k}' must be ISO date YYYY-MM-DD (got {v!r})")
            elif isinstance(v, str):
                if not DATE_RE.match(v):
                    errors.append(f"'{k}' must be ISO date YYYY-MM-DD (got {v!r})")
            else:
                errors.append(
                    f"'{k}' must be ISO date YYYY-MM-DD (got {type(v).__name__})"
                )

    if "affects" in fm:
        v = fm["affects"]
        if not isinstance(v, list) or len(v) == 0:
            errors.append("'affects' must be a non-empty list")
        else:
            for i, item in enumerate(v):
                if not isinstance(item, str) or not item.strip():
                    errors.append(f"affects[{i}] must be a non-empty string path")
                    continue
                if item.startswith("/"):
                    errors.append(
                        f"affects[{i}] '{item}' must be relative (no leading '/')"
                    )
                if item.startswith("./"):
                    errors.append(f"affects[{i}] '{item}' must not start with './'")
                if "\\" in item:
                    errors.append(f"affects[{i}] '{item}' must use forward slashes")

    for k in ("supersedes", "superseded_by"):
        if k in fm and fm[k] is not None:
            v = fm[k]
            if not isinstance(v, str) or not SLUG_RE.match(v):
                errors.append(
                    f"'{k}' must be a kebab-case slug ([a-z0-9-]+) — got {v!r}"
                )

    return errors


fail = 0
for p in sys.argv[1:]:
    rel = os.path.relpath(p)
    errs = validate(p)
    if errs:
        fail += 1
        for e in errs:
            print(f"FAIL\t{rel}\t{e}")
    else:
        print(f"OK\t{rel}")
sys.exit(1 if fail else 0)
PYEOF
)
py_status=$?
set -e

if [ "${py_status}" -eq 2 ]; then
  err "PyYAML missing — install with: pip install pyyaml"
  exit 1
fi

fail_count=0
while IFS=$'\t' read -r tok rel rest; do
  [ -z "${tok:-}" ] && continue
  case "${tok}" in
    OK)
      ok "${rel}"
      ;;
    FAIL)
      err "${rel} :: ${rest}"
      fail_count=$((fail_count + 1))
      ;;
  esac
done <<< "${output}"

if [ "${py_status}" -ne 0 ] || [ "${fail_count}" -ne 0 ]; then
  printf "[validate-decisions] %d decision(s) failed validation\n" "${fail_count}" >&2
  exit 1
fi

note "all ${#files[@]} decision(s) valid"
