#!/usr/bin/env bash
# Lattice validate — smoke-tests plugin manifest + command frontmatter.
# Run before commit; CI runs it on every push.
#
# Checks:
#   1. .claude-plugin/plugin.json is valid JSON
#   2. .claude-plugin/marketplace.json is valid JSON
#   3. Every commands/*.md starts with YAML frontmatter (--- ... ---)
#   4. Every command has a `description` field in its frontmatter
#
# Exits non-zero on any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note()   { printf "[validate] %s\n" "$*"; }
warn()   { printf "[validate] WARN: %s\n" "$*" >&2; fail=1; }
ok()     { printf "[validate]   ok: %s\n" "$*"; }

note "validating plugin manifests"
for f in "${ROOT}/.claude-plugin/plugin.json" "${ROOT}/.claude-plugin/marketplace.json"; do
  if [ ! -f "${f}" ]; then
    warn "missing: ${f}"
    continue
  fi
  if ! python3 -c "import json,sys; json.load(open(sys.argv[1]))" "${f}" 2>/dev/null; then
    if ! node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "${f}" 2>/dev/null; then
      warn "invalid JSON: ${f}"
      continue
    fi
  fi
  ok "$(basename "${f}")"
done

note "validating command frontmatter"
shopt -s nullglob
for cmd in "${ROOT}/commands/"*.md; do
  name="$(basename "${cmd}")"
  first_line="$(head -n 1 "${cmd}")"
  if [ "${first_line}" != "---" ]; then
    warn "${name}: missing YAML frontmatter (first line is not '---')"
    continue
  fi
  if ! grep -qE '^description:' "${cmd}"; then
    warn "${name}: missing 'description:' field in frontmatter"
    continue
  fi
  ok "${name}"
done

if [ "${fail}" -ne 0 ]; then
  printf "[validate] FAILED\n" >&2
  exit 1
fi

printf "[validate] all checks passed\n"
