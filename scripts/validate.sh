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

# --quick: skip the lifecycle test suite section. Useful when iterating on
# polish and the suite already ran green seconds ago. CI / release builds
# must still call validate.sh without --quick to enforce the gate.
QUICK=0
for arg in "$@"; do
  case "${arg}" in
    --quick) QUICK=1 ;;
  esac
done

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

# Shared helper used by 1b + 1d. Defined once, here, so 1b can call it.
read_json_field() {
  local file="$1" expr="$2"
  python3 -c "import json,sys; print(json.load(open(sys.argv[1]))${expr})" "${file}" 2>/dev/null \
    || node -e "const o=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));process.stdout.write(String(o${expr}))" "${file}" 2>/dev/null \
    || echo ""
}

# --- 1b. Stale version refs in README / CHANGELOG (v0.6.3.1) ------------
# Catches the drift the user reported: README + CHANGELOG referencing 0.6.2
# while plugin.json was already at 0.6.3.
note "checking README/CHANGELOG for stale 'current' version refs"
plugin_ver_for_drift=$(read_json_field "${ROOT}/.claude-plugin/plugin.json" "['version']" 2>/dev/null || true)
if [ -n "${plugin_ver_for_drift:-}" ]; then
  for f in "${ROOT}/README.md" "${ROOT}/CHANGELOG.md"; do
    [ -f "${f}" ] || continue
    # Look for "(current)" tags or "current version" claims pointing at a different version.
    stale=$(grep -nE '\(current\)' "${f}" | grep -vE "${plugin_ver_for_drift}" || true)
    if [ -n "${stale}" ]; then
      warn "$(basename "${f}"): '(current)' tag does not match plugin.json (${plugin_ver_for_drift})"
      printf "%s\n" "${stale}" | sed 's/^/[validate]     /' >&2
    else
      ok "$(basename "${f}"): no stale '(current)' version drift"
    fi
  done
fi

# --- 1c2. Installer/updater coverage (v0.6.4.1) -------------------------
# Catches the drift class where install.sh / update.sh COMMANDS or SCRIPTS
# arrays don't match what's actually in the repo. Has happened twice:
# v0.6.3 (missing lattice-reopen.sh + migrate-status.sh) and v0.6.4 (missing
# flow-audit). Now structurally checked so it can't slip past CI again.
note "checking install.sh / update.sh cover every commands/*.md and lifecycle helper"
expected_cmds=()
for cmd in "${ROOT}/commands/"*.md; do
  expected_cmds+=( "$(basename "${cmd}" .md)" )
done

for installer in "${ROOT}/scripts/install.sh" "${ROOT}/scripts/update.sh"; do
  [ -f "${installer}" ] || continue
  installer_name="$(basename "${installer}")"
  cmds_line=$(grep -E '^COMMANDS=\(' "${installer}" || true)
  if [ -z "${cmds_line}" ]; then
    warn "${installer_name}: no COMMANDS=(...) array found"
    continue
  fi
  for cmd in "${expected_cmds[@]}"; do
    if ! printf "%s" "${cmds_line}" | grep -qE "\"${cmd}\""; then
      warn "${installer_name}: COMMANDS missing '${cmd}' (commands/${cmd}.md exists in repo)"
    fi
  done
done

# Same check for lifecycle helper scripts: every lattice-*.sh + migrate*.sh
# at top of scripts/ should appear in installer SCRIPTS arrays.
expected_scripts=()
for s in "${ROOT}/scripts/"lattice-*.sh "${ROOT}/scripts/"migrate*.sh "${ROOT}/scripts/lattice"; do
  [ -f "${s}" ] || continue
  expected_scripts+=( "$(basename "${s}")" )
done
for installer in "${ROOT}/scripts/install.sh" "${ROOT}/scripts/update.sh"; do
  [ -f "${installer}" ] || continue
  installer_name="$(basename "${installer}")"
  scripts_line=$(grep -E '^SCRIPTS=\(' "${installer}" || true)
  if [ -z "${scripts_line}" ]; then
    warn "${installer_name}: no SCRIPTS=(...) array found"
    continue
  fi
  for s in "${expected_scripts[@]}"; do
    if ! printf "%s" "${scripts_line}" | grep -qF "\"${s}\""; then
      warn "${installer_name}: SCRIPTS missing '${s}' (scripts/${s} exists in repo)"
    fi
  done
done
ok "installer/updater coverage check done"

# --- 1c. Legacy path/format patterns inside command bodies (v0.6.3.1) ---
# Catches commands that still tell module agents to write legacy
# audit-<module>-<ts>.md files or to .cc-reef/. These contradict the YAML schema
# silently and cause downstream pipeline confusion.
note "checking commands/*.md for legacy path or filename patterns"
for cmd in "${ROOT}/commands/"*.md; do
  name="$(basename "${cmd}")"
  legacy=$(grep -nE '\.cc-reef/|audit-<module>-<ts>\.md|scale-<module>-<ts>\.md|security-<module>-<ts>\.md' "${cmd}" || true)
  if [ -n "${legacy}" ]; then
    warn "${name}: legacy path/filename pattern detected"
    printf "%s\n" "${legacy}" | sed 's/^/[validate]     /' >&2
  else
    ok "${name}: no legacy patterns"
  fi
done

# --- 1d. Version match ---------------------------------------------------
note "checking plugin/marketplace version match"
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

# --- 7. v0.6 helpers exist ---------------------------------------------
note "checking v0.6 lifecycle helpers"
for helper in lattice lattice-close.sh lattice-regenerate.sh lattice-reopen.sh; do
  if [ ! -f "${ROOT}/scripts/${helper}" ]; then
    warn "missing scripts/${helper}"
  else
    if ! bash -n "${ROOT}/scripts/${helper}" 2>/dev/null; then
      warn "${helper}: bash syntax error"
    else
      ok "${helper}"
    fi
  fi
done

# --- 7b. Stop-hook detach regression (#176) -----------------------------
# lattice-stop.mjs must spawn the review child with detached:true + unref()
# and exit well inside its 2s budget — detached:false silently killed the
# review child for weeks (2026-06-10 incident). Node-based static + timing
# assertions; see test/stop-hook-detach.test.mjs for the full rationale.
note "running stop-hook detach regression test (#176)"
if command -v node >/dev/null 2>&1; then
  if node "${ROOT}/test/stop-hook-detach.test.mjs" > /tmp/lattice-stop-hook-test.log 2>&1; then
    ok "stop-hook-detach.test.mjs"
  else
    warn "stop-hook-detach.test.mjs failed (output below):"
    sed 's/^/[validate]   /' /tmp/lattice-stop-hook-test.log >&2 || true
  fi
else
  warn "node not found — cannot run test/stop-hook-detach.test.mjs (stop hook is node-based)"
fi

# --- 8. Schema doc declares v0.7 YAML format ---------------------------
note "checking schema doc declares v0.7 YAML format"
if grep -qE 'one YAML file per finding' "${ROOT}/docs/finding-schema.md" 2>/dev/null; then
  ok "schema declares v0.7 YAML format"
else
  warn "docs/finding-schema.md does not declare 'one YAML file per finding' (v0.7 contract)"
fi

# --- 8a. CLAUDE.md drift gate (v0.6.3) --------------------------------
# Enforces that lattice-regenerate.sh is the only path to update the markered
# block. If anyone hand-edits the section, this CI check fails the build.
note "checking CLAUDE.md drift (v0.6.3 regen-only enforcement)"
if [ -f "${ROOT}/CLAUDE.md" ] && [ -d "${ROOT}/.lattice/findings" ]; then
  if bash "${ROOT}/scripts/lattice-regenerate.sh" --check > /tmp/lattice-regen-check.log 2>&1; then
    ok "CLAUDE.md is in sync with .lattice/findings/"
  else
    sed 's/^/[validate]   /' /tmp/lattice-regen-check.log >&2 || true
    warn "CLAUDE.md drift detected — run scripts/lattice-regenerate.sh and commit"
  fi
else
  ok "CLAUDE.md drift check skipped (no CLAUDE.md or no .lattice/findings/ in plugin repo)"
fi

# --- 9. Functional lifecycle test suite (v0.6.2 protection layer) -----
if [ "${QUICK}" -eq 1 ]; then
  note "skipping lifecycle test suite (--quick) — re-run \`bash scripts/test-lifecycle.sh\` directly when needed"
else
  note "running lifecycle test suite"
  if [ -f "${ROOT}/scripts/test-lifecycle.sh" ]; then
    if bash "${ROOT}/scripts/test-lifecycle.sh" > /tmp/lattice-test-output.log 2>&1; then
      ok "test-lifecycle.sh"
    else
      warn "test-lifecycle.sh failed (output below):"
      sed 's/^/[validate]   /' /tmp/lattice-test-output.log >&2 || true
    fi
  else
    warn "missing scripts/test-lifecycle.sh (lifecycle protection layer)"
  fi
fi

# --- 10. Self-audit gate (v0.7.2+) -------------------------------------
# Refuse to validate if Lattice has open CRITICAL/HIGH findings against
# itself. Run `/audit README.md` (or any /audit invocation pointed at
# Lattice's own code) to populate .lattice/findings/open/; any tier
# CRITICAL or HIGH there blocks the release.
note "self-audit gate (v0.7.2+)"
fail_findings=()
if [ -d "${ROOT}/.lattice/findings/open" ]; then
  shopt -s nullglob
  for f in "${ROOT}/.lattice/findings/open"/*.yml; do
    if grep -qE '^tier:[[:space:]]*(CRITICAL|HIGH)([[:space:]]|$)' "${f}" 2>/dev/null; then
      fail_findings+=("${f}")
    fi
  done
fi
if [ "${#fail_findings[@]}" -gt 0 ]; then
  warn "self-audit gate: open CRITICAL/HIGH findings against Lattice:"
  for f in "${fail_findings[@]}"; do
    printf "[validate]   %s\n" "${f}" >&2
  done
  printf "[validate]   close or downgrade before tagging: lattice list\n" >&2
else
  ok "self-audit gate clean"
fi

# --- Result ------------------------------------------------------------
if [ "${fail}" -ne 0 ]; then
  printf "[validate] FAILED\n" >&2
  exit 1
fi

printf "[validate] all checks passed\n"
