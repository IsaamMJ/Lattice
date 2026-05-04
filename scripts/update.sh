#!/usr/bin/env bash
# Lattice update — pulls latest commands + helper scripts + schema docs from main branch
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/update.sh | bash
#
# Safe to run repeatedly. Mirrors install.sh's full set so commands and scripts stay in sync.

set -euo pipefail

RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep" "flow-audit")
SCRIPTS=("lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "migrate.sh" "migrate-status.sh")
DOCS=("finding-schema.md" "methodology.md" "contract-format.md")

DEST="${HOME}/.claude/commands"
SCRIPT_DEST="${HOME}/.claude/lattice/scripts"
DOC_DEST="${HOME}/.claude/lattice/docs"

if [ ! -d "${DEST}" ]; then
  echo "[lattice] no install found at ${DEST} — run install.sh first" >&2
  exit 1
fi

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

mkdir -p "${SCRIPT_DEST}" "${DOC_DEST}"

PREV="$(cat "${HOME}/.claude/lattice/VERSION" 2>/dev/null || echo "unknown")"
echo "[lattice] previously installed: ${PREV}"

echo "[lattice] updating commands"
for cmd in "${COMMANDS[@]}"; do
  echo "[lattice]   commands/${cmd}.md"
  fetch "${RAW}/commands/${cmd}.md" "${DEST}/${cmd}.md"
done

echo "[lattice] updating helper scripts"
for s in "${SCRIPTS[@]}"; do
  echo "[lattice]   scripts/${s}"
  fetch "${RAW}/scripts/${s}" "${SCRIPT_DEST}/${s}"
  chmod +x "${SCRIPT_DEST}/${s}" 2>/dev/null || true
done

echo "[lattice] updating schema docs"
for d in "${DOCS[@]}"; do
  if fetch "${RAW}/docs/${d}" "${DOC_DEST}/${d}" 2>/dev/null; then
    echo "[lattice]   docs/${d}"
  else
    echo "[lattice]   docs/${d} (skipped — not present in repo)"
  fi
done

VERSION="$(curl -fsSL "${RAW}/.claude-plugin/plugin.json" 2>/dev/null | grep -oE '"version"\s*:\s*"[^"]+"' | head -n1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/' || echo "unknown")"
printf "%s\n" "${VERSION}" > "${HOME}/.claude/lattice/VERSION"

echo ""
echo "[lattice] updated ${#COMMANDS[@]} commands + ${#SCRIPTS[@]} scripts + ${#DOCS[@]} docs."
echo "[lattice] ${PREV} -> ${VERSION}"
echo "[lattice] restart Claude Code to pick up command changes."
