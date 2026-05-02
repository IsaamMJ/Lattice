#!/usr/bin/env bash
# Lattice validate — smoke-tests plugin manifest, command frontmatter, and cross-skill consistency.
# Run before commit; CI runs it on every push.
#
# Checks:
#   1. .claude-plugin/plugin.json + marketplace.json are valid JSON
#   2. Every commands/*.md starts with YAML frontmatter (--- ... ---) and has a `description:` field
#   3. Every command writes findings to `.lattice/findings/` (no `.cc-reef/` regressions)
#   4. Every command has a Tool-usage section
#   5. README quickstart commands all exist as files in commands/
#   6. plugin.json version matches marketplace.json version
#   7. docs/finding-schema.md exists (output schema contract)
#
# Exits non-zero on any failure.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fail=0

note()   { printf "[validate] %s\n" "$*"; }
warn()   { printf "[validate] WARN: %s\n" "$*" >&2; fail=1; }
ok()     { printf "[validate]   ok: %s\n" "$*"; }

# --- 1. Manifest JSON ----------------------------------------------------
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

# --- 1b. Version match ---------------------------------------------------
note "checking plugin/marketplace version match"
read_json_field() {
  local file="$1" expr="$2"
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))${expr})" "${file}" 2>/dev/null \
    || node -e "const o=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(o${expr}))" "${file}" 2>/dev/null \
    || echo ""
}
plugin_ver=$(read_json_field "${ROOT}/.claude-plugin/plugin.json" "['version']")
mkt_ver=$(read_json_field "${ROOT}/.claude-plugin/marketplace.json" "['plugins'][0]['version']")
if [ -z "${plugin_ver}" ] || [ -z "${mkt_ver}" ]; then
  warn "could not read versions (plugin=${plugin_ver}, marketplace=${mkt_ver})"
elif [ "${plugin_ver}" != "${mkt_ver}" ]; then
  warn "version mismatch: plugin.json=${plugin_ver} marketplace.json=${mkt_ver}"
else
  ok "version: ${plugin_ver}"
fi

# --- 2. Command frontmatter ---------------------------------------------
note "validating command frontmatter"
shopt -s nullglob
declare -a command_names
for cmd in "${ROOT}/commands/"*.md; do
  name="$(basename "${cmd}")"
  command_names+=("${name%.md}")
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

# --- 3. Output path consistency (.lattice/findings/, no .cc-reef/) ------
note "checking output path consistency across commands"
for cmd in "${ROOT}/commands/"*.md; do
  name="$(basename "${cmd}")"
  if grep -qE '\.cc-reef/' "${cmd}"; then
    warn "${name}: references legacy '.cc-reef/' path (should be '.lattice/findings/')"
    continue
  fi
  # Skills that write findings should mention .lattice/findings/
  if grep -qE 'Write|findings' "${cmd}" && ! grep -qE '\.lattice/findings/' "${cmd}"; then
    warn "${name}: writes findings but never references '.lattice/findings/' path"
    continue
  fi
  ok "${name}: paths consistent"
done

# --- 4. Tool usage section ---------------------------------------------
note "checking each command documents its tool usage"
for cmd in "${ROOT}/commands/"*.md; do
  name="$(basename "${cmd}")"
  if ! grep -qiE '^## (tool usage|tools)' "${cmd}"; then
    warn "${name}: missing '## Tool usage' section"
    continue
  fi
  ok "${name}: tool usage documented"
done

# --- 5. README quickstart commands exist -------------------------------
note "checking README quickstart commands all exist as files"
if [ -f "${ROOT}/README.md" ]; then
  while IFS= read -r line; do
    cmd_ref=$(echo "${line}" | grep -oE '/[a-z-]+' | head -n1 | sed 's|^/||')
    [ -z "${cmd_ref}" ] && continue
    if [ ! -f "${ROOT}/commands/${cmd_ref}.md" ]; then
      warn "README references /${cmd_ref} but commands/${cmd_ref}.md missing"
    fi
  done < <(grep -E '^/(audit|scale-audit|security-audit|audit-sweep|lattice:)' "${ROOT}/README.md" || true)
  ok "README command references"
fi

# --- 6. Output schema contract exists ----------------------------------
note "checking output schema contract"
if [ ! -f "${ROOT}/docs/finding-schema.md" ]; then
  warn "missing docs/finding-schema.md (U5 — output schema contract)"
else
  ok "docs/finding-schema.md present"
fi

# --- Result ------------------------------------------------------------
if [ "${fail}" -ne 0 ]; then
  printf "[validate] FAILED\n" >&2
  exit 1
fi

printf "[validate] all checks passed\n"
