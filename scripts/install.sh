#!/usr/bin/env bash
# Lattice install — copies command files + helper scripts + schema docs
# Usage: curl -fsSL https://raw.githubusercontent.com/IsaamMJ/Lattice/main/scripts/install.sh | bash

set -euo pipefail

REPO="https://github.com/IsaamMJ/Lattice"
RAW="https://raw.githubusercontent.com/IsaamMJ/Lattice/main"
COMMANDS=("audit" "scale-audit" "security-audit" "audit-sweep" "flow-audit" "lattice-fix")
SCRIPTS=("lattice" "lattice-close.sh" "lattice-regenerate.sh" "lattice-reopen.sh" "lattice-write-manifest.sh" "migrate.sh" "migrate-status.sh" "migrate-v0.7.sh" "lattice-completion.bash" "lattice-completion.zsh" "prepare-commit-msg.sh" "post-commit-resolve-pending.sh")
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
echo "[lattice] CLI dispatcher (v0.9.9) installed at:"
echo "[lattice]   ${SCRIPT_DEST}/lattice"
echo ""

# v0.8.3 (#13): auto-install a shim in ~/.local/bin so `lattice` resolves from
# any shell without an alias step. Falls back to a wrapper script on systems
# where symlinks fail (Windows without developer-mode). Skips silently when
# ~/.local/bin already has a Lattice shim pointing at SCRIPT_DEST.
SHIM_DIR="${HOME}/.local/bin"
SHIM_PATH="${SHIM_DIR}/lattice"
mkdir -p "${SHIM_DIR}" 2>/dev/null || true

shim_ok=0
shim_kind=""
if [ -L "${SHIM_PATH}" ] && [ "$(readlink "${SHIM_PATH}" 2>/dev/null)" = "${SCRIPT_DEST}/lattice" ]; then
  shim_ok=1; shim_kind="existing symlink"
elif [ -f "${SHIM_PATH}" ] && grep -q "${SCRIPT_DEST}/lattice" "${SHIM_PATH}" 2>/dev/null; then
  shim_ok=1; shim_kind="existing wrapper"
else
  # Try a real symlink first; fall back to a tiny exec wrapper if symlink fails.
  if ln -sfn "${SCRIPT_DEST}/lattice" "${SHIM_PATH}" 2>/dev/null; then
    shim_ok=1; shim_kind="symlink"
  else
    cat > "${SHIM_PATH}" <<WRAPPER
#!/usr/bin/env bash
exec bash "${SCRIPT_DEST}/lattice" "\$@"
WRAPPER
    chmod +x "${SHIM_PATH}" 2>/dev/null || true
    [ -x "${SHIM_PATH}" ] && { shim_ok=1; shim_kind="wrapper script"; }
  fi
fi

if [ "${shim_ok}" -eq 1 ]; then
  echo "[lattice] shim installed at ${SHIM_PATH} (${shim_kind})"
else
  echo "[lattice] WARN: could not install shim at ${SHIM_PATH} — fall back to manual alias:"
  echo "[lattice]   alias lattice=\"${SCRIPT_DEST}/lattice\""
fi

# PATH check: is ~/.local/bin actually on PATH right now? If not, write a
# one-line guard into the user's shell rc so the next shell picks it up.
case ":${PATH}:" in
  *":${SHIM_DIR}:"*)
    echo "[lattice] ${SHIM_DIR} already on PATH — \`lattice\` will resolve in new shells"
    ;;
  *)
    echo "[lattice] note: ${SHIM_DIR} is NOT on your current PATH"
    rc_target=""
    if [ -n "${ZSH_VERSION:-}" ] || [ -n "${BASH_VERSION:-}" ]; then
      # Prefer the rc file the user actually has.
      for rc in "${HOME}/.zshrc" "${HOME}/.bashrc" "${HOME}/.bash_profile" "${HOME}/.profile"; do
        if [ -f "${rc}" ]; then rc_target="${rc}"; break; fi
      done
    fi
    # If we found one and it doesn't already mention .local/bin, append the guard line.
    if [ -n "${rc_target}" ] && ! grep -q '\.local/bin' "${rc_target}" 2>/dev/null; then
      {
        echo ""
        echo "# Added by lattice install.sh — ensures ~/.local/bin is on PATH"
        echo 'case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) export PATH="$HOME/.local/bin:$PATH" ;; esac'
      } >> "${rc_target}"
      echo "[lattice] added PATH guard to ${rc_target}"
      echo "[lattice] open a new shell (or: source ${rc_target}) and \`lattice help\` will work"
    else
      echo "[lattice] add manually to your shell rc:"
      echo "[lattice]   export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    ;;
esac
echo ""
echo "[lattice] verify: lattice doctor"
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
