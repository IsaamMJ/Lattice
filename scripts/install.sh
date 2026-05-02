#!/usr/bin/env bash
# Lattice install — copies command files to ~/.claude/commands/
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

set -euo pipefail

REPO="https://github.com/IsaamMJ/Lattice"
RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep")
DEST="${HOME}/.claude/commands"

echo "[lattice] installing to ${DEST}"
mkdir -p "${DEST}"

for cmd in "${COMMANDS[@]}"; do
  url="${RAW}/commands/${cmd}.md"
  dest="${DEST}/${cmd}.md"
  echo "[lattice]   ${cmd}.md"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${url}" -o "${dest}"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "${dest}" "${url}"
  else
    echo "[lattice] error: need curl or wget" >&2
    exit 1
  fi
done

echo ""
echo "[lattice] installed ${#COMMANDS[@]} commands."
echo "[lattice] restart Claude Code to load them, then try:"
echo "[lattice]   /audit-sweep ."
echo ""
echo "[lattice] docs: ${REPO}#readme"
