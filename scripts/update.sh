#!/usr/bin/env bash
# Lattice update — pulls latest command files from main branch
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/update.sh | bash
#
# Safe to run repeatedly. Identical to install.sh except logs "updating" instead of "installing".

set -euo pipefail

RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep")
DEST="${HOME}/.claude/commands"

if [ ! -d "${DEST}" ]; then
  echo "[lattice] no install found at ${DEST} — run install.sh first" >&2
  exit 1
fi

echo "[lattice] updating commands in ${DEST}"

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
echo "[lattice] updated ${#COMMANDS[@]} commands. Restart Claude Code to pick up changes."
