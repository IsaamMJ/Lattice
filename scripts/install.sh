#!/usr/bin/env bash
# Lattice install — copies command files + helper scripts + schema docs
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

set -euo pipefail

REPO="https://github.com/IsaamMJ/Lattice"
RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep" "flow-audit" "lattice-fix")
SCRIPTS=("lattice" "lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "lattice-write-manifest.sh" "migrate.sh" "migrate-status.sh" "migrate-v0.7.sh" "lattice-completion.bash" "lattice-completion.zsh" "prepare-commit-msg.sh")
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
echo ""
echo "[lattice] restart Claude Code to load commands, then try:"
echo "[lattice]   /audit-sweep ."
echo ""
echo "[lattice] CLI dispatcher (v0.7.5) installed at:"
echo "[lattice]   ${SCRIPT_DEST}/lattice"
echo ""
echo "[lattice] add to PATH (one-time, copy whichever fits your shell):"
echo "[lattice]   echo 'alias lattice=\"${SCRIPT_DEST}/lattice\"' >> ~/.bashrc"
echo "[lattice]   echo 'alias lattice=\"${SCRIPT_DEST}/lattice\"' >> ~/.zshrc"
echo "[lattice]   # or: ln -s ${SCRIPT_DEST}/lattice ~/.local/bin/lattice"
echo ""
echo "[lattice] then run \`lattice help\` from any project root."
echo ""
echo "[lattice] docs: ${REPO}#readme"
echo ""
echo "[lattice] tab completion (optional):"
echo "[lattice]   bash: echo 'source ${SCRIPT_DEST}/lattice-completion.bash' >> ~/.bashrc"
echo "[lattice]   zsh:  echo 'source ${SCRIPT_DEST}/lattice-completion.zsh'  >> ~/.zshrc"
echo ""
echo "[lattice] v0.7 migration (if upgrading from v0.6):"
echo "[lattice]   bash ${SCRIPT_DEST}/migrate-v0.7.sh --dry-run   # preview"
echo "[lattice]   bash ${SCRIPT_DEST}/migrate-v0.7.sh             # apply"
