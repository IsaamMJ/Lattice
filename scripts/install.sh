#!/usr/bin/env bash
# Lattice install — copies command files + helper scripts + schema docs
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

set -euo pipefail

REPO="https://github.com/IsaamMJ/Lattice"
RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep")
SCRIPTS=("lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "migrate.sh" "migrate-status.sh")
DOCS=("finding-schema.md" "methodology.md" "contract-format.md")

DEST="${HOME}/.claude/commands"
SCRIPT_DEST="${HOME}/.claude/lattice/scripts"
DOC_DEST="${HOME}/.claude/lattice/docs"

fetch() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${out}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${out}" "${url}"
  else
    echo "[lattice] error: need curl or wget" >&2
    exit 1
  fi
}

mkdir -p "${DEST}" "${SCRIPT_DEST}" "${DOC_DEST}"

echo "[lattice] installing commands to ${DEST}"
for cmd in "${COMMANDS[@]}"; do
  echo "[lattice]   commands/${cmd}.md"
  fetch "${RAW}/commands/${cmd}.md" "${DEST}/${cmd}.md"
done

echo "[lattice] installing helper scripts to ${SCRIPT_DEST}"
for s in "${SCRIPTS[@]}"; do
  echo "[lattice]   scripts/${s}"
  fetch "${RAW}/scripts/${s}" "${SCRIPT_DEST}/${s}"
  chmod +x "${SCRIPT_DEST}/${s}" 2>/dev/null || true
done

echo "[lattice] installing schema docs to ${DOC_DEST}"
for d in "${DOCS[@]}"; do
  # methodology + contract-format are optional — don't fail if absent in repo
  if fetch "${RAW}/docs/${d}" "${DOC_DEST}/${d}" 2>/dev/null; then
    echo "[lattice]   docs/${d}"
  else
    echo "[lattice]   docs/${d} (skipped — not present in repo yet)"
  fi
done

# Version sentinel — lets `lattice --version` (and update.sh) report what's installed
mkdir -p "${HOME}/.claude/lattice"
VERSION="$(curl -fsSL "${RAW}/.claude-plugin/plugin.json" 2>/dev/null | grep -oE '"version"\s*:\s*"[^"]+"' | head -n1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/' || echo "unknown")"
printf "%s\n" "${VERSION}" > "${HOME}/.claude/lattice/VERSION"
echo "[lattice] version sentinel: ${VERSION}"

echo ""
echo "[lattice] installed ${#COMMANDS[@]} commands + ${#SCRIPTS[@]} scripts + ${#DOCS[@]} docs."
echo "[lattice] restart Claude Code to load commands, then try:"
echo "[lattice]   /audit-sweep ."
echo ""
echo "[lattice] docs: ${REPO}#readme"
